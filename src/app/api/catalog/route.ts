import { NextRequest, NextResponse } from 'next/server';
import gifsData from '../../../../data/gifs.json';

interface CatalogItem {
  id: number;
  slug: string;
  title: string;
  category: string;
  file: string;
  type?: string;
  url?: string;
  tags?: string[];
  source?: string;
  sourceUrl?: string;
}

const items = gifsData as CatalogItem[];

export async function GET(req: NextRequest) {
  const { searchParams } = new URL(req.url);
  const q = (searchParams.get('q') || searchParams.get('search') || '').trim().toLowerCase();
  const slugParam = (searchParams.get('id') || searchParams.get('slug') || '').trim().toLowerCase();
  const category = (searchParams.get('category') || '').trim().toLowerCase();
  const type = (searchParams.get('type') || '').trim().toLowerCase();
  const limit = Math.min(2500, Math.max(1, parseInt(searchParams.get('limit') || '200', 10) || 200));

  let filtered = items;

  if (slugParam) {
    filtered = filtered.filter(
      (it) => it.slug.toLowerCase() === slugParam || String(it.id) === slugParam
    );
  }

  if (category) {
    filtered = filtered.filter((it) => it.category.toLowerCase() === category);
  }

  if (type) {
    filtered = filtered.filter((it) => (it.type || 'gif').toLowerCase() === type);
  }

  if (q) {
    const terms = q.split(/\s+/).filter(Boolean);
    filtered = filtered.filter((it) => {
      const hay = [
        it.slug,
        it.title,
        it.category,
        it.file,
        ...(it.tags || []),
        it.source || '',
      ]
        .join(' ')
        .toLowerCase();
      return terms.every((t) => hay.includes(t));
    });
  }

  const sliced = filtered.slice(0, limit);

  return NextResponse.json(
    {
      schema: 'gifbox-catalog-v1',
      site: 'https://gifbox.netlify.app',
      totalMatched: filtered.length,
      returned: sliced.length,
      usage: {
        search: 'https://gifbox.netlify.app/api/catalog?q=wojak',
        byId: 'https://gifbox.netlify.app/api/catalog?id=wojak-group-hug',
        byCategory: 'https://gifbox.netlify.app/api/catalog?category=Memes',
        fullStaticCatalog: 'https://gifbox.netlify.app/catalog.json',
      },
      items: sliced,
    },
    {
      headers: {
        'Access-Control-Allow-Origin': '*',
        'Cache-Control': 'public, max-age=60, s-maxage=300',
      },
    }
  );
}
