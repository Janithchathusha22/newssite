import { Navigate, Route, Routes } from 'react-router-dom';
import { AppShell } from './components/AppShell';
import { useNewsroom } from './state/NewsroomContext';
import { ArticleEditorPage } from './pages/ArticleEditorPage';
import { ArticlesPage } from './pages/ArticlesPage';
import { DashboardPage } from './pages/DashboardPage';
import { LoginPage } from './pages/LoginPage';
import { NotFoundPage } from './pages/NotFoundPage';
import { SourcesPage } from './pages/SourcesPage';
import { TopNewsPage } from './pages/TopNewsPage';

function ProtectedLayout() {
  const { session } = useNewsroom();
  return session ? <AppShell /> : <Navigate to="/login" replace />;
}

export default function App() {
  return (
    <Routes>
      <Route path="/login" element={<LoginPage />} />
      <Route element={<ProtectedLayout />}>
        <Route index element={<Navigate to="/dashboard" replace />} />
        <Route path="/dashboard" element={<DashboardPage />} />
        <Route path="/articles" element={<ArticlesPage />} />
        <Route path="/articles/pending" element={<ArticlesPage />} />
        <Route path="/articles/published" element={<ArticlesPage />} />
        <Route path="/articles/rejected" element={<ArticlesPage />} />
        <Route path="/articles/:articleId/edit" element={<ArticleEditorPage />} />
        <Route path="/articles/:articleId/preview" element={<ArticleEditorPage forcePreview />} />
        <Route path="/top-news" element={<TopNewsPage />} />
        <Route path="/sources" element={<SourcesPage />} />
      </Route>
      <Route path="*" element={<NotFoundPage />} />
    </Routes>
  );
}
