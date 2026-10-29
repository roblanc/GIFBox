'use client';

import React, { useEffect, useMemo, useRef, useState } from 'react';
import Image from 'next/image';
import gifsSeedRaw from '../../data/gifs-seed.json';
import FreeformBoard, { LibraryGifInput } from '../components/FreeformBoard';

interface Gif {
  id: number;
  slug?: string;
  title: string;
  category: string;
  file: string;
  type?: string;
  format?: string;
  tags?: string[];
  source?: string;
  url?: string;
  cutoutUrl?: string;
  previewUrl?: string;
  sourceUrl?: string;
}

const initialGifsData = gifsSeedRaw as Gif[];
const PAGE_SIZE = 36;

function getMediaSrc(gif: Gif): string {
  // Prefer direct CDN URL (jsDelivr / Supabase) so assets load from Cloudflare edge cache (max-age=31536000)
  // instead of hitting Netlify's uncached serverless fallback rewrite.
  if (gif.url && gif.url.startsWith('http')) {
    if (gif.url.startsWith('https://gifbox.netlify.app/gifs/')) {
      return gif.url.replace('https://gifbox.netlify.app', '');
    }
    return gif.url;
  }
  if (gif.file && !gif.file.startsWith('http')) {
    return `/gifs/${gif.file}`;
  }
  return gif.url || `/gifs/${gif.file}`;
}

function getPreviewSrc(gif: Gif): string {
  if (gif.previewUrl) return gif.previewUrl;
  return getMediaSrc(gif);
}

function matchesFormat(
  gif: Gif,
  fmt: 'all' | 'images' | 'gifs' | 'videos' | 'stickers'
): boolean {
  if (fmt === 'all') return true;
  if (fmt === 'stickers') return gif.category === 'Stickers' || Boolean(gif.cutoutUrl);
  if (fmt === 'images') return gif.type === 'image';
  if (fmt === 'videos') return gif.category === 'Video Memes';
  if (fmt === 'gifs') {
    return gif.type === 'gif' || (gif.type === 'video' && gif.category !== 'Video Memes');
  }
  return true;
}

// Silent looping clip that plays immediately for top cards and lazy-loads offscreen cards.
function VideoClip({
  src,
  poster,
  title,
  eager = false,
}: {
  src: string;
  poster?: string;
  title: string;
  eager?: boolean;
}) {
  const ref = useRef<HTMLVideoElement>(null);
  const [visible, setVisible] = useState(eager);
  useEffect(() => {
    const el = ref.current;
    if (!el) return;
    const io = new IntersectionObserver(([entry]) => setVisible(entry.isIntersecting), {
      rootMargin: '400px',
    });
    io.observe(el);
    return () => io.disconnect();
  }, []);
  useEffect(() => {
    const el = ref.current;
    if (!el) return;
    if (visible) el.play().catch(() => {});
    else el.pause();
  }, [visible]);
  return (
    <video
      ref={ref}
      src={visible ? src : undefined}
      poster={poster}
      title={title}
      muted
      loop
      playsInline
      autoPlay={eager}
      preload={eager ? 'auto' : 'metadata'}
      style={{ maxWidth: '100%', maxHeight: '165px', objectFit: 'contain' }}
    />
  );
}

export default function Home() {
  const [gifsData, setGifsData] = useState<Gif[]>(initialGifsData);
  const [searchTerm, setSearchTerm] = useState('');
  const [selectedFormat, setSelectedFormat] = useState<
    'all' | 'images' | 'gifs' | 'videos' | 'stickers'
  >('all');
  const [selectedCategory, setSelectedCategory] = useState('All');
  const [shown, setShown] = useState(PAGE_SIZE);

  const leftPaneRef = useRef<HTMLDivElement>(null);
  const loadMoreRef = useRef<HTMLDivElement>(null);

  // Hydrate full 11,405-item catalog in background after instant initial paint
  useEffect(() => {
    let active = true;
    fetch('/catalog.json')
      .then((r) => r.json())
      .then((data) => {
        if (active && Array.isArray(data?.items) && data.items.length > 0) {
          setGifsData(data.items as Gif[]);
        }
      })
      .catch(() => {});
    return () => {
      active = false;
    };
  }, []);

  // Split screen state
  const [splitMode, setSplitMode] = useState<'split' | 'library' | 'board'>('split');
  const [leftWidthPct, setLeftWidthPct] = useState<number>(42);
  const [isResizingSplit, setIsResizingSplit] = useState<boolean>(false);
  const [pendingBoardItem, setPendingBoardItem] = useState<LibraryGifInput | null>(null);
  const [copiedId, setCopiedId] = useState<number | null>(null);
  const [preferCutoutsGlobal, setPreferCutoutsGlobal] = useState<boolean>(false);
  const [cardCutoutOverrides, setCardCutoutOverrides] = useState<Record<number, boolean>>({
    11406: true,
  });

  const isUsingCutout = (gif: Gif): boolean => {
    if (!gif.cutoutUrl) return false;
    if (gif.id in cardCutoutOverrides) return cardCutoutOverrides[gif.id];
    if (selectedFormat === 'stickers') return true;
    return preferCutoutsGlobal;
  };

  const getActiveMediaSrc = (gif: Gif): string => {
    if (isUsingCutout(gif) && gif.cutoutUrl) return gif.cutoutUrl;
    return getMediaSrc(gif);
  };

  const getActivePreviewSrc = (gif: Gif): string => {
    if (isUsingCutout(gif) && gif.cutoutUrl) return gif.cutoutUrl;
    return getPreviewSrc(gif);
  };

  const toggleCardCutout = (e: React.MouseEvent, gif: Gif) => {
    e.stopPropagation();
    e.preventDefault();
    const curr = isUsingCutout(gif);
    setCardCutoutOverrides((prev) => ({ ...prev, [gif.id]: !curr }));
  };

  // Pre-compute search index once when catalog updates
  const indexedGifs = useMemo(
    () =>
      gifsData.map((g) => ({
        gif: g,
        haystack: [g.slug || '', g.title, g.category, ...(g.tags || [])]
          .join(' ')
          .toLowerCase(),
      })),
    [gifsData]
  );

  const formatCounts = useMemo(() => {
    let images = 0;
    let gifs = 0;
    let videos = 0;
    let stickers = 0;
    let cutouts = 0;
    for (const g of gifsData) {
      if (matchesFormat(g, 'images')) images++;
      if (matchesFormat(g, 'gifs')) gifs++;
      if (matchesFormat(g, 'videos')) videos++;
      if (matchesFormat(g, 'stickers')) stickers++;
      if (g.cutoutUrl) cutouts++;
    }
    return {
      all: gifsData.length,
      images,
      gifs,
      videos,
      stickers,
      cutouts,
    };
  }, [gifsData]);

  const formatFilteredGifs = useMemo(
    () => indexedGifs.filter(({ gif }) => matchesFormat(gif, selectedFormat)),
    [indexedGifs, selectedFormat]
  );

  const categories = useMemo(
    () => ['All', ...Array.from(new Set(formatFilteredGifs.map(({ gif }) => gif.category)))],
    [formatFilteredGifs]
  );

  const filteredGifs = useMemo(() => {
    const q = searchTerm.trim().toLowerCase();
    return formatFilteredGifs
      .filter(({ gif, haystack }) => {
        const categoryMatch = selectedCategory === 'All' || gif.category === selectedCategory;
        if (!categoryMatch) return false;
        if (!q) return true;
        return haystack.includes(q);
      })
      .map(({ gif }) => gif);
  }, [formatFilteredGifs, selectedCategory, searchTerm]);

  // Automatic infinite scroll when reaching bottom of left library pane
  useEffect(() => {
    const sentinel = loadMoreRef.current;
    if (!sentinel) return;
    const io = new IntersectionObserver(
      ([entry]) => {
        if (entry.isIntersecting) {
          setShown((prev) => Math.min(filteredGifs.length, prev + PAGE_SIZE));
        }
      },
      { root: leftPaneRef.current, rootMargin: '500px' }
    );
    io.observe(sentinel);
    return () => io.disconnect();
  }, [filteredGifs.length]);

  useEffect(() => {
    if (!isResizingSplit) return;
    const onMove = (e: MouseEvent) => {
      const pct = (e.clientX / window.innerWidth) * 100;
      setLeftWidthPct(Math.min(75, Math.max(22, pct)));
    };
    const onUp = () => setIsResizingSplit(false);
    window.addEventListener('mousemove', onMove);
    window.addEventListener('mouseup', onUp);
    return () => {
      window.removeEventListener('mousemove', onMove);
      window.removeEventListener('mouseup', onUp);
    };
  }, [isResizingSplit]);

  const handleDragStartCard = (e: React.DragEvent, gif: Gif) => {
    const origSrc = getMediaSrc(gif);
    const originalUrl = origSrc.startsWith('http')
      ? origSrc
      : `https://gifbox.netlify.app${origSrc}`;
    const srcUrl = getActiveMediaSrc(gif);
    const payload: LibraryGifInput = {
      id: gif.id,
      slug: gif.slug,
      title: gif.title,
      category: gif.category,
      file: gif.file,
      type: gif.type,
      srcUrl,
      originalUrl,
      cutoutUrl: gif.cutoutUrl,
    };
    e.dataTransfer.setData('application/x-gifbox-item', JSON.stringify(payload));
    e.dataTransfer.setData('text/uri-list', srcUrl);
    e.dataTransfer.setData('text/plain', srcUrl);
    e.dataTransfer.effectAllowed = 'copy';
  };

  const handleSendToBoard = (gif: Gif) => {
    if (splitMode === 'library') {
      setSplitMode('split');
    }
    const origSrc = getMediaSrc(gif);
    const originalUrl = origSrc.startsWith('http')
      ? origSrc
      : `https://gifbox.netlify.app${origSrc}`;
    setPendingBoardItem({
      id: gif.id,
      slug: gif.slug,
      title: gif.title,
      category: gif.category,
      file: gif.file,
      type: gif.type,
      srcUrl: getActiveMediaSrc(gif),
      originalUrl,
      cutoutUrl: gif.cutoutUrl,
    });
  };

  const handleCopyReference = async (gif: Gif) => {
    const slugId =
      gif.slug ||
      gif.file
        .split('/')
        .pop()
        ?.replace(/\.[^.]+$/, '') ||
      String(gif.id);
    const activeCutout = isUsingCutout(gif);
    const mediaSrc = getActiveMediaSrc(gif);
    const directUrl = mediaSrc.startsWith('http')
      ? mediaSrc
      : `https://gifbox.netlify.app${mediaSrc}`;
    const itemFormat = activeCutout
      ? 'cutout'
      : gif.format || (gif.category === 'Stickers' ? 'sticker' : gif.type || 'gif');
    const refLine = `[GIFBOX Ref] ID: ${slugId} (#${gif.id}) | Title: "${gif.title}" | Type: ${itemFormat} (${gif.category}) | URL: ${directUrl}`;
    try {
      await navigator.clipboard.writeText(refLine);
      setCopiedId(gif.id);
      window.setTimeout(() => {
        setCopiedId((curr) => (curr === gif.id ? null : curr));
      }, 1800);
    } catch {
      // ignore clipboard errors
    }
  };

  return (
    <main
      style={{
        display: 'flex',
        flexDirection: 'column',
        height: '100vh',
        width: '100vw',
        overflow: 'hidden',
      }}
    >
      {/* Top App Bar */}
      <header
        style={{
          display: 'flex',
          alignItems: 'center',
          justifyContent: 'space-between',
          gap: '12px',
          padding: '10px 18px',
          background: '#11131a',
          color: '#ffffff',
          borderBottom: '1px solid rgba(255,255,255,0.1)',
          flexShrink: 0,
        }}
      >
        <div style={{ display: 'flex', alignItems: 'center', gap: '12px' }}>
          <h1 style={{ fontSize: '22px', fontWeight: 800, margin: 0, letterSpacing: '-0.5px' }}>
            📦 GIFBox
          </h1>
          <span
            style={{
              fontSize: '12px',
              color: 'rgba(255,255,255,0.6)',
              display: 'none',
            }}
            className="d-md-inline"
          >
            A clever, cheeky box of GIFs + Freeform Studio Board
          </span>
        </div>

        {/* View Mode Switcher */}
        <div style={{ display: 'flex', alignItems: 'center', gap: '6px' }}>
          <button
            type="button"
            onClick={() => setSplitMode('split')}
            style={{
              padding: '5px 12px',
              fontSize: '12px',
              fontWeight: 600,
              borderRadius: '6px',
              border:
                splitMode === 'split'
                  ? '1px solid #4dabf7'
                  : '1px solid rgba(255,255,255,0.16)',
              background: splitMode === 'split' ? '#1971c2' : '#1e2230',
              color: '#fff',
              cursor: 'pointer',
            }}
          >
            ◫ Split Studio
          </button>
          <button
            type="button"
            onClick={() => setSplitMode('library')}
            style={{
              padding: '5px 12px',
              fontSize: '12px',
              fontWeight: 600,
              borderRadius: '6px',
              border:
                splitMode === 'library'
                  ? '1px solid #4dabf7'
                  : '1px solid rgba(255,255,255,0.16)',
              background: splitMode === 'library' ? '#1971c2' : '#1e2230',
              color: '#fff',
              cursor: 'pointer',
            }}
          >
            📚 Library Only
          </button>
          <button
            type="button"
            onClick={() => setSplitMode('board')}
            style={{
              padding: '5px 12px',
              fontSize: '12px',
              fontWeight: 600,
              borderRadius: '6px',
              border:
                splitMode === 'board'
                  ? '1px solid #4dabf7'
                  : '1px solid rgba(255,255,255,0.16)',
              background: splitMode === 'board' ? '#1971c2' : '#1e2230',
              color: '#fff',
              cursor: 'pointer',
            }}
          >
            🎨 Canvas Only
          </button>
        </div>
      </header>

      {/* Split Workspace */}
      <div
        style={{
          display: 'flex',
          flex: 1,
          minHeight: 0,
          width: '100%',
          position: 'relative',
          overflow: 'hidden',
        }}
      >
        {/* LEFT PANE: GIF Library */}
        {splitMode !== 'board' && (
          <div
            ref={leftPaneRef}
            style={{
              width: splitMode === 'library' ? '100%' : `${leftWidthPct}%`,
              height: '100%',
              overflowY: 'auto',
              padding: '16px',
              background: 'var(--background)',
              color: 'var(--foreground)',
              flexShrink: 0,
            }}
          >
            {/* Search, Media Format Switcher, and Category Controls */}
            <div className="mb-3">
              <div className="d-flex gap-2 align-items-center mb-2">
                <input
                  type="text"
                  className="form-control"
                  placeholder={`Search ${gifsData.length.toLocaleString()} memes, GIFs & clips by title, #id, or tag...`}
                  value={searchTerm}
                  onChange={(e) => {
                    setSearchTerm(e.target.value);
                    setShown(PAGE_SIZE);
                  }}
                />
                <span className="badge bg-secondary" style={{ whiteSpace: 'nowrap' }}>
                  {filteredGifs.length.toLocaleString()} items
                </span>
              </div>

              {/* Media Format Filter Row (Images vs GIFs vs Video Memes vs Stickers) */}
              <div className="d-flex flex-wrap gap-1 mb-2 pb-2 border-bottom">
                {(
                  [
                    { id: 'all', label: `All Media (${formatCounts.all.toLocaleString()})` },
                    { id: 'images', label: `🖼️ Images (${formatCounts.images.toLocaleString()})` },
                    { id: 'gifs', label: `🎞️ GIFs (${formatCounts.gifs.toLocaleString()})` },
                    {
                      id: 'videos',
                      label: `🎬 Video Memes (${formatCounts.videos.toLocaleString()})`,
                    },
                    {
                      id: 'stickers',
                      label: `✂️ Stickers & Cutouts (${formatCounts.stickers.toLocaleString()})`,
                    },
                  ] as {
                    id: 'all' | 'images' | 'gifs' | 'videos' | 'stickers';
                    label: string;
                  }[]
                ).map((fmt) => (
                  <button
                    key={fmt.id}
                    type="button"
                    className={`btn btn-sm fw-semibold ${
                      selectedFormat === fmt.id ? 'btn-dark' : 'btn-outline-dark'
                    }`}
                    onClick={() => {
                      setSelectedFormat(fmt.id);
                      setSelectedCategory('All');
                      setShown(PAGE_SIZE);
                      leftPaneRef.current?.scrollTo({ top: 0 });
                    }}
                  >
                    {fmt.label}
                  </button>
                ))}
                {formatCounts.cutouts > 0 && (
                  <button
                    type="button"
                    className={`btn btn-sm fw-semibold ${
                      preferCutoutsGlobal ? 'btn-success' : 'btn-outline-success'
                    }`}
                    onClick={() => {
                      const next = !preferCutoutsGlobal;
                      setPreferCutoutsGlobal(next);
                      setCardCutoutOverrides({});
                    }}
                    title="Toggle all character memes between Original background and transparent No-BG cutout"
                  >
                    {preferCutoutsGlobal
                      ? `✂️ All No-BG: ON (${formatCounts.cutouts.toLocaleString()})`
                      : `✂️ All No-BG: OFF (${formatCounts.cutouts.toLocaleString()})`}
                  </button>
                )}
              </div>

              {/* Category Pills Row */}
              <div className="d-flex flex-wrap gap-1">
                {categories.map((category) => (
                  <button
                    key={category}
                    type="button"
                    className={`btn btn-sm ${
                      selectedCategory === category ? 'btn-primary' : 'btn-outline-secondary'
                    }`}
                    onClick={() => {
                      setSelectedCategory(category);
                      setShown(PAGE_SIZE);
                      leftPaneRef.current?.scrollTo({ top: 0 });
                    }}
                  >
                    {category}
                  </button>
                ))}
              </div>
            </div>

            {/* GIF Grid */}
            <div className="row g-3">
              {filteredGifs.length > 0 ? (
                filteredGifs.slice(0, shown).map((gif: Gif, idx: number) => {
                  const colClass =
                    splitMode === 'split'
                      ? 'col-xl-4 col-md-6 col-sm-6'
                      : 'col-lg-3 col-md-4 col-sm-6';
                  const activeCutout = isUsingCutout(gif);
                  const showCheckerboard = activeCutout || gif.category === 'Stickers';
                  const badgeLabel =
                    gif.category === 'Stickers'
                      ? 'STICKER'
                      : activeCutout
                      ? 'NO-BG'
                      : gif.type === 'image'
                      ? 'IMG'
                      : gif.category === 'Video Memes'
                      ? 'VIDEO'
                      : 'GIF';
                  const badgeBg =
                    badgeLabel === 'NO-BG'
                      ? '#087f5b'
                      : badgeLabel === 'IMG'
                      ? '#1971c2'
                      : badgeLabel === 'GIF'
                      ? '#2f9e44'
                      : badgeLabel === 'STICKER'
                      ? '#e67700'
                      : '#7048e8';
                  const isEager = idx < 18;
                  return (
                    <div key={gif.id} className={colClass}>
                      <div
                        className="card h-100 shadow-sm"
                        draggable
                        onDragStart={(e) => handleDragStartCard(e, gif)}
                        title="Drag onto the right board or click + Board"
                        style={{ cursor: 'grab' }}
                      >
                        <div
                          style={{
                            width: '100%',
                            height: '170px',
                            backgroundColor: '#f0f0f0',
                            ...(showCheckerboard
                              ? {
                                  backgroundImage:
                                    'linear-gradient(45deg, #e2e5ea 25%, transparent 25%), linear-gradient(-45deg, #e2e5ea 25%, transparent 25%), linear-gradient(45deg, transparent 75%, #e2e5ea 75%), linear-gradient(-45deg, transparent 75%, #e2e5ea 75%)',
                                  backgroundSize: '16px 16px',
                                  backgroundPosition: '0 0, 0 8px, 8px -8px, -8px 0px',
                                }
                              : {}),
                            display: 'flex',
                            alignItems: 'center',
                            justifyContent: 'center',
                            overflow: 'hidden',
                            position: 'relative',
                          }}
                        >
                          {gif.cutoutUrl && (
                            <button
                              type="button"
                              onClick={(e) => toggleCardCutout(e, gif)}
                              title={
                                activeCutout
                                  ? 'Showing transparent No-BG character cutout — click for Original'
                                  : 'Click to remove background (character cutout)'
                              }
                              style={{
                                position: 'absolute',
                                top: '6px',
                                left: '6px',
                                background: activeCutout
                                  ? '#087f5b'
                                  : 'rgba(17, 19, 26, 0.78)',
                                color: '#fff',
                                border: activeCutout
                                  ? '1px solid #38d9a9'
                                  : '1px solid rgba(255,255,255,0.35)',
                                fontSize: '10px',
                                fontWeight: 700,
                                padding: '2px 7px',
                                borderRadius: '12px',
                                zIndex: 3,
                                cursor: 'pointer',
                                lineHeight: 1.4,
                              }}
                            >
                              {activeCutout ? '🖼 Orig' : '✂️ No-BG'}
                            </button>
                          )}
                          <span
                            style={{
                              position: 'absolute',
                              top: '6px',
                              right: '6px',
                              background: badgeBg,
                              color: '#fff',
                              fontSize: '9px',
                              fontWeight: 700,
                              padding: '2px 5px',
                              borderRadius: '4px',
                              zIndex: 2,
                              letterSpacing: '0.4px',
                              opacity: 0.9,
                            }}
                          >
                            {badgeLabel}
                          </span>
                          {gif.type === 'video' ? (
                            <VideoClip
                              src={getMediaSrc(gif)}
                              poster={gif.previewUrl}
                              title={gif.title}
                              eager={isEager}
                            />
                          ) : (
                            <Image
                              src={getActivePreviewSrc(gif)}
                              alt={gif.title}
                              width={145}
                              height={145}
                              loading={isEager ? 'eager' : 'lazy'}
                              style={{ objectFit: 'contain' }}
                              unoptimized={true}
                              onError={(e) => {
                                const target = e.target as HTMLImageElement;
                                target.style.display = 'none';
                                const parent = target.parentElement;
                                if (parent) {
                                  const text = document.createElement('span');
                                  text.className = 'text-muted small';
                                  text.innerText = 'Image not found';
                                  parent.appendChild(text);
                                }
                              }}
                            />
                          )}
                        </div>
                        <div className="card-body p-2 text-center">
                          <h6
                            className="card-title mb-1"
                            style={{
                              fontSize: '13px',
                              overflow: 'hidden',
                              textOverflow: 'ellipsis',
                              whiteSpace: 'nowrap',
                            }}
                            title={gif.title}
                          >
                            {gif.title}
                          </h6>
                          {gif.slug && (
                            <div
                              onClick={() => handleCopyReference(gif)}
                              title="Click to copy AI reference (ID, title & direct URL)"
                              style={{
                                fontSize: '10px',
                                fontFamily: 'monospace',
                                color: '#6c757d',
                                overflow: 'hidden',
                                textOverflow: 'ellipsis',
                                whiteSpace: 'nowrap',
                                cursor: 'pointer',
                                marginBottom: '2px',
                              }}
                            >
                              {gif.slug} (#{gif.id})
                            </div>
                          )}
                          {gif.source && (
                            <p
                              className="card-text small text-muted mb-0"
                              style={{ fontSize: '11px' }}
                            >
                              {gif.sourceUrl || gif.url ? (
                                <a href={gif.sourceUrl || gif.url} target="_blank" rel="noreferrer">
                                  {gif.source}
                                </a>
                              ) : (
                                gif.source
                              )}
                            </p>
                          )}
                        </div>
                        <div className="card-footer p-2 d-flex gap-1">
                          <button
                            type="button"
                            onClick={() => handleSendToBoard(gif)}
                            className="btn btn-sm btn-primary flex-grow-1"
                            title="Add this clip to the Freeform Board"
                          >
                            + Board
                          </button>
                          <button
                            type="button"
                            onClick={() => handleCopyReference(gif)}
                            className={`btn btn-sm ${
                              copiedId === gif.id ? 'btn-warning' : 'btn-outline-secondary'
                            }`}
                            title="Copy Reference for AI (ID, title, direct original URL)"
                          >
                            {copiedId === gif.id ? '✓ Ref' : '📋 Ref'}
                          </button>
                          <a
                            href={getActiveMediaSrc(gif)}
                            target="_blank"
                            rel="noreferrer"
                            download
                            className="btn btn-sm btn-success"
                            title={
                              activeCutout
                                ? 'Download transparent No-BG cutout'
                                : 'Download original file'
                            }
                          >
                            ⬇
                          </a>
                        </div>
                      </div>
                    </div>
                  );
                })
              ) : (
                <div className="col text-center py-5">
                  <p>No GIFs found. Try adjusting your search or filter.</p>
                </div>
              )}
            </div>

            {filteredGifs.length > shown && (
              <div ref={loadMoreRef} className="text-center my-4">
                <button
                  type="button"
                  className="btn btn-outline-primary"
                  onClick={() => setShown(shown + PAGE_SIZE)}
                >
                  Show more ({(filteredGifs.length - shown).toLocaleString()} left)
                </button>
              </div>
            )}
          </div>
        )}

        {/* DRAGGABLE SPLIT DIVIDER */}
        {splitMode === 'split' && (
          <div
            onMouseDown={() => setIsResizingSplit(true)}
            title="Drag to resize split screen"
            style={{
              width: '8px',
              cursor: 'col-resize',
              background: isResizingSplit ? '#339af0' : '#1e2230',
              borderLeft: '1px solid rgba(255,255,255,0.1)',
              borderRight: '1px solid rgba(255,255,255,0.1)',
              display: 'flex',
              alignItems: 'center',
              justifyContent: 'center',
              flexShrink: 0,
              zIndex: 30,
            }}
          >
            <div
              style={{
                width: '2px',
                height: '36px',
                background: 'rgba(255,255,255,0.35)',
                borderRadius: '2px',
              }}
            />
          </div>
        )}

        {/* RIGHT PANE: Freeform Studio Board */}
        {splitMode !== 'library' && (
          <div style={{ flex: 1, minWidth: 0, height: '100%' }}>
            <FreeformBoard
              pendingItem={pendingBoardItem}
              onPendingConsumed={() => setPendingBoardItem(null)}
              splitMode={splitMode}
              onChangeSplitMode={setSplitMode}
            />
          </div>
        )}
      </div>
    </main>
  );
}
