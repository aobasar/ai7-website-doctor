"""AI7 Website Doctor demo lab.

A small, reproducible copy of the demo customer's stack. It runs inside a
long-lived Daytona sandbox, and the diagnostic probes run inside the same
sandbox against it:

  :8081  origin web server (the store itself; healthy)
  :8080  edge / CDN proxy with a misconfigured cache rule that also stores 5xx
         responses. It starts with a 502 for /checkout cached ~49 minutes ago,
         as if the server failed for a moment during this morning's deploy.
  :5353  authoritative DNS for ai7demo.app (UDP). MX already points to Google,
         but SPF still only allows the old mail provider and DMARC is missing.

Lab control (used by the "customer action" buttons, never by the agent):
  GET /__lab/purge      purge /checkout from the edge cache
  GET /__lab/fix-email  publish the SPF + DMARC records from the setup message
  GET /__lab/reset      back to the broken starting state
  GET /__lab/status     JSON state

Python standard library + dnspython only, so it starts without network access.
"""
import json
import socketserver
import threading
import time
from http.server import BaseHTTPRequestHandler, ThreadingHTTPServer

import dns.flags
import dns.message
import dns.rcode
import dns.rdatatype
import dns.rrset

DOMAIN = "ai7demo.app."
EDGE_IP = "198.51.100.7"
LOCK = threading.Lock()
STATE = {}

ORIGIN_PAGES = {
    "/": (200, b"<h1>AI7 Demo Store</h1>"),
    "/checkout": (200, b"<h1>Checkout</h1><p>Your cart: 2 items</p>"),
    "/api/health/payments": (200, b'{"ok": true}'),
}


def reset():
    with LOCK:
        STATE.clear()
        STATE["cache"] = {
            "/checkout": {"status": 502, "body": b"<h1>502 Bad Gateway</h1>", "stored": time.time() - 2940},
        }
        STATE["spf"] = "v=spf1 include:_spf.oldhost-mail.net ~all"
        STATE["dmarc"] = None


class Origin(BaseHTTPRequestHandler):
    server_version = "ai7-origin"

    def do_GET(self):
        status, body = ORIGIN_PAGES.get(self.path.split("?")[0], (404, b"not found"))
        self.send_response(status)
        self.send_header("Content-Type", "text/html")
        self.send_header("Cache-Control", "public, max-age=3600")
        self.end_headers()
        self.wfile.write(body)

    def log_message(self, *args):
        pass


class Edge(BaseHTTPRequestHandler):
    server_version = "ai7-edge"

    def _send(self, status, body, headers):
        self.send_response(status)
        for k, v in headers.items():
            self.send_header(k, str(v))
        self.end_headers()
        self.wfile.write(body)

    def do_GET(self):
        path = self.path.split("?")[0]
        if path.startswith("/__lab/"):
            return self._lab(path)
        with LOCK:
            hit = STATE["cache"].get(path)
        if hit:
            age = int(time.time() - hit["stored"])
            return self._send(hit["status"], hit["body"], {"X-Cache": "HIT", "Age": age, "Content-Type": "text/html"})
        status, body = ORIGIN_PAGES.get(path, (404, b"not found"))
        # The misconfigured rule: everything is cached, including 5xx errors.
        with LOCK:
            STATE["cache"][path] = {"status": status, "body": body, "stored": time.time()}
        return self._send(status, body, {"X-Cache": "MISS", "Age": 0, "Content-Type": "text/html"})

    def _lab(self, path):
        if path == "/__lab/reset":
            reset()
            msg = "lab reset"
        else:
            with LOCK:
                if path == "/__lab/purge":
                    STATE["cache"].pop("/checkout", None)
                    msg = "purged /checkout"
                elif path == "/__lab/fix-email":
                    STATE["spf"] = "v=spf1 include:_spf.google.com ~all"
                    STATE["dmarc"] = "v=DMARC1; p=none; rua=mailto:dmarc@ai7demo.app"
                    msg = "SPF and DMARC published"
                elif path == "/__lab/status":
                    msg = json.dumps({"cache": sorted(STATE["cache"]), "spf": STATE["spf"], "dmarc": STATE["dmarc"]})
                else:
                    return self._send(404, b"unknown lab action", {"Content-Type": "text/plain"})
        self._send(200, msg.encode(), {"Content-Type": "text/plain"})

    def log_message(self, *args):
        pass


def dns_answer(query):
    resp = dns.message.make_response(query)
    resp.flags |= dns.flags.AA
    q = query.question[0]
    name = q.name.to_text().lower()
    with LOCK:
        spf, dmarc = STATE["spf"], STATE["dmarc"]
    records = {}
    if name in ("shop." + DOMAIN, "www." + DOMAIN) and q.rdtype == dns.rdatatype.A:
        records["A"] = [EDGE_IP]
    elif name == DOMAIN and q.rdtype == dns.rdatatype.MX:
        records["MX"] = ["1 aspmx.l.google.com.", "5 alt1.aspmx.l.google.com.", "5 alt2.aspmx.l.google.com.",
                         "10 alt3.aspmx.l.google.com.", "10 alt4.aspmx.l.google.com."]
    elif name == DOMAIN and q.rdtype == dns.rdatatype.TXT:
        records["TXT"] = [f'"{spf}"', '"google-site-verification=ai7demo-lab"']
    elif name == "_dmarc." + DOMAIN and q.rdtype == dns.rdatatype.TXT and dmarc:
        records["TXT"] = [f'"{dmarc}"']
    for rtype, values in records.items():
        resp.answer.append(dns.rrset.from_text(q.name, 300, "IN", rtype, *values))
    if not name.endswith(DOMAIN):
        resp.set_rcode(dns.rcode.REFUSED)
    elif name == "_dmarc." + DOMAIN and not dmarc:
        resp.set_rcode(dns.rcode.NXDOMAIN)
    return resp


class DNSHandler(socketserver.BaseRequestHandler):
    def handle(self):
        data, sock = self.request
        try:
            sock.sendto(dns_answer(dns.message.from_wire(data)).to_wire(), self.client_address)
        except Exception:
            pass


if __name__ == "__main__":
    reset()
    threading.Thread(target=ThreadingHTTPServer(("0.0.0.0", 8081), Origin).serve_forever, daemon=True).start()
    threading.Thread(target=socketserver.ThreadingUDPServer(("127.0.0.1", 5353), DNSHandler).serve_forever, daemon=True).start()
    print("lab up: edge :8080, origin :8081, dns :5353", flush=True)
    ThreadingHTTPServer(("0.0.0.0", 8080), Edge).serve_forever()
