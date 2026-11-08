import { createRoot } from 'react-dom/client';
import { ConversationProvider } from '@elevenlabs/react';
import { App } from './App';
import './styles.css';

createRoot(document.getElementById('root')!).render(
  <ConversationProvider>
    <App />
  </ConversationProvider>,
);
