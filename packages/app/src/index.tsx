import '@backstage/cli/asset-types';
import ReactDOM from 'react-dom/client';
import App from './App';
import '@backstage/ui/css/styles.css';
import './styles/globalLayout.css';
import './styles/scaffolderLayout.css';

// Suppress the widespread Material-UI v4 findDOMNode warnings in React 18 StrictMode
// eslint-disable-next-line no-console
const originalConsoleError = console.error;
// eslint-disable-next-line no-console
console.error = (...args) => {
  if (
    typeof args[0] === 'string' &&
    args[0].includes('findDOMNode is deprecated')
  ) {
    return;
  }
  originalConsoleError(...args);
};

ReactDOM.createRoot(document.getElementById('root')!).render(App.createRoot());
