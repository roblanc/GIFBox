import { NextRequest, NextResponse } from 'next/server';
import gifsData from '../../../../data/gifs.json';

export const dynamic = 'force-dynamic';

interface CatalogItem {
  id: number;
  slug: string;
  title: string;
  category: string;
  file: string;
  type?: string;
  format?: string;
  url?: string;
  cutoutUrl?: string;
  tags?: string[];
  source?: string;
  sourceUrl?: string;
}

const items = gifsData as CatalogItem[];

function toSlug(str: string): string {
  return (str || '')
    .toLowerCase()
    .replace(/[^a-z0-9_-]+/g, '-')
    .replace(/^-+|-+$/g, '');
}

export async function GET(req: NextRequest) {
  const { searchParams } = new URL(req.url);
  const q = (searchParams.get('q') || searchParams.get('search') || '').trim().toLowerCase();
  const slugParam = (searchParams.get('id') || searchParams.get('slug') || '')
    .trim()
    .toLowerCase()
    .replace(/^#/, '');
  const category = (searchParams.get('category') || '').trim().toLowerCase();
  const formatParam = (searchParams.get('format') || searchParams.get('type') || '')
    .trim()
    .toLowerCase();
  const cutoutParam = (
    searchParams.get('cutout') ||
    searchParams.get('hasCutout') ||
    ''
  )
    .trim()
    .toLowerCase();
  const offset = Math.max(0, parseInt(searchParams.get('offset') || '0', 10) || 0);
  const limit = Math.min(15000, Math.max(1, parseInt(searchParams.get('limit') || '200', 10) || 200));

  let filtered = items;

  if (slugParam) {
    filtered = filtered.filter((it) => {
      const s = it.slug.toLowerCase();
      const catSlug = toSlug(it.category);
      return (
        s === slugParam ||
        String(it.id) === slugParam ||
        `${catSlug}-${s}` === slugParam
      );
    });
  }

  if (category) {
    filtered = filtered.filter((it) => it.category.toLowerCase() === category);
  }

  if (formatParam) {
    filtered = filtered.filter((it) => {
      if (formatParam === 'cutout' || formatParam === 'cutouts') {
        return Boolean(it.cutoutUrl);
      }
      const fmt = (
        it.format ||
        (it.category.toLowerCase() === 'stickers' ? 'sticker' : it.type || 'gif')
      ).toLowerCase();
      const typ = (it.type || 'gif').toLowerCase();
      if (formatParam === 'sticker' || formatParam === 'stickers') {
        return fmt === 'sticker' || it.category.toLowerCase() === 'stickers';
      }
      return fmt === formatParam || typ === formatParam;
    });
  }

  if (cutoutParam === 'true' || cutoutParam === '1' || cutoutParam === 'yes') {
    filtered = filtered.filter(
      (it) => Boolean(it.cutoutUrl) || it.category.toLowerCase() === 'stickers'
    );
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

  const sliced = filtered.slice(offset, offset + limit);

  return NextResponse.json(
    {
      schema: 'gifbox-catalog-v1',
      site: 'https://gifbox.netlify.app',
      totalMatched: filtered.length,
      returned: sliced.length,
      offset,
      usage: {
        search: 'https://gifbox.netlify.app/api/catalog?q=wojak',
        byId: 'https://gifbox.netlify.app/api/catalog?id=chad-dario',
        byFormat: 'https://gifbox.netlify.app/api/catalog?format=sticker',
        byCategory: 'https://gifbox.netlify.app/api/catalog?category=Memes',
        fullStaticCatalog: 'https://gifbox.netlify.app/catalog.json',
      },
      items: sliced,
    },
    {
      headers: {
        'Access-Control-Allow-Origin': '*',
        'Cache-Control': 'no-store, max-age=0',
        'Netlify-Vary': 'query',
      },
    }
  );
}
