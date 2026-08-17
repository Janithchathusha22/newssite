import { StrictMode } from 'react';
import { createRoot } from 'react-dom/client';
import { BrowserRouter } from 'react-router-dom';
import App from './App';
import { ToastProvider } from './components/Toast';
import { NewsroomProvider } from './state/NewsroomContext';
import './styles.css';

createRoot(document.getElementById('root')!).render(
  <StrictMode>
    <BrowserRouter>
      <NewsroomProvider>
        <ToastProvider>
          <App />
        </ToastProvider>
      </NewsroomProvider>
    </BrowserRouter>
  </StrictMode>,
);
