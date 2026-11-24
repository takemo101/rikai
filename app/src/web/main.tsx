import { QueryClientProvider } from '@tanstack/react-query';
import { StrictMode } from 'react';
import { createRoot } from 'react-dom/client';
import { App } from './App';
import { queryClient } from './api/queryClient';
import { loadUi } from './lib/storage';
import { applyTheme } from './lib/theme';
import { getView } from './lib/view';
import { bindView } from './store/ui';
import './styles/app.css';
import './styles/connectors.css';

// 保存した外観は、public/assets/theme-init.js が、<head> で、描く前に付ける（ちらつき〔FOUC〕を避ける）。ここで、もう一度付ける（ストアの初期値と一致させる。害はない）。system は、付けない
applyTheme(loadUi().theme);

// ストアは、上の層（`api`・`lib/view`）を import しない：見ている版を返す関数を、起動時に結ぶ（入力欄を開く・版を並べて比べるときに使う）
bindView(getView);

const root = document.getElementById('root');
if (!root) throw new Error('#root がありません');
createRoot(root).render(
  <StrictMode>
    <QueryClientProvider client={queryClient}>
      <App />
    </QueryClientProvider>
  </StrictMode>,
);
