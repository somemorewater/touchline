import { ArticleView } from '@/features/news/NewsView';

export default async function ArticlePage({ params }: { params: Promise<{ articleId: string }> }) {
  const { articleId } = await params;
  return <ArticleView id={articleId} />;
}
