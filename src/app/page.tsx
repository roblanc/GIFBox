'use client';

import React, { useEffect, useRef, useState } from 'react';
import Image from 'next/image';
import gifsDataRaw from '../../data/gifs.json';
import FreeformBoard, { LibraryGifInput } from '../components/FreeformBoard';

interface Gif {
  id: number;
  title: string;
  category: string;
  file: string;
  type?: string;
  tags?: string[];
  source?: string;
  url?: string;
}

const gifsData = gifsDataRaw as Gif[];
const PAGE_SIZE = 120;

// Silent looping clip that only loads and plays while it is on screen.
function VideoClip({ src, title }: { src: string; title: string }) {
  const ref = useRef<HTMLVideoElement>(null);
  const [visible, setVisible] = useState(false);
  useEffect(() => {
    const el = ref.current;
    if (!el) return;
    const io = new IntersectionObserver(([entry]) => setVisible(entry.isIntersecting), {
      rootMargin: '200px',
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
      title={title}
      muted
      loop
      playsInline
      preload="none"
      style={{ maxWidth: '100%', maxHeight: '165px', objectFit: 'contain' }}
    />
  );
}

export default function Home() {
  const [searchTerm, setSearchTerm] = useState('');
  const [selectedCategory, setSelectedCategory] = useState('All');
  const [shown, setShown] = useState(PAGE_SIZE);

  // Split screen state
  const [splitMode, setSplitMode] = useState<'split' | 'library' | 'board'>('split');
  const [leftWidthPct, setLeftWidthPct] = useState<number>(42);
  const [isResizingSplit, setIsResizingSplit] = useState<boolean>(false);
  const [pendingBoardItem, setPendingBoardItem] = useState<LibraryGifInput | null>(null);

  const categories = ['All', ...Array.from(new Set(gifsData.map((g) => g.category)))];

  const filteredGifs = gifsData.filter((gif) => {
    const categoryMatch = selectedCategory === 'All' || gif.category === selectedCategory;
    const haystack = [gif.title, ...(gif.tags || [])].join(' ').toLowerCase();
    const searchMatch = haystack.includes(searchTerm.toLowerCase());
    return categoryMatch && searchMatch;
  });

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
    const payload: LibraryGifInput = {
      id: gif.id,
      title: gif.title,
      category: gif.category,
      file: gif.file,
      type: gif.type,
      srcUrl: `/gifs/${gif.file}`,
    };
    e.dataTransfer.setData('application/x-gifbox-item', JSON.stringify(payload));
    e.dataTransfer.setData('text/uri-list', `/gifs/${gif.file}`);
    e.dataTransfer.setData('text/plain', `/gifs/${gif.file}`);
    e.dataTransfer.effectAllowed = 'copy';
  };

  const handleSendToBoard = (gif: Gif) => {
    if (splitMode === 'library') {
      setSplitMode('split');
    }
    setPendingBoardItem({
      id: gif.id,
      title: gif.title,
      category: gif.category,
      file: gif.file,
      type: gif.type,
      srcUrl: `/gifs/${gif.file}`,
    });
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
            {/* Search and Category Controls */}
            <div className="mb-3">
              <div className="d-flex gap-2 align-items-center mb-2">
                <input
                  type="text"
                  className="form-control"
                  placeholder="Search 2,198 GIFs & clips by title or tag..."
                  value={searchTerm}
                  onChange={(e) => {
                    setSearchTerm(e.target.value);
                    setShown(PAGE_SIZE);
                  }}
                />
                <span className="badge bg-secondary" style={{ whiteSpace: 'nowrap' }}>
                  {filteredGifs.length} clips
                </span>
              </div>

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
                filteredGifs.slice(0, shown).map((gif: Gif) => {
                  const colClass =
                    splitMode === 'split'
                      ? 'col-xl-4 col-md-6 col-sm-6'
                      : 'col-lg-3 col-md-4 col-sm-6';
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
                            display: 'flex',
                            alignItems: 'center',
                            justifyContent: 'center',
                            overflow: 'hidden',
                          }}
                        >
                          {gif.type === 'video' ? (
                            <VideoClip src={`/gifs/${gif.file}`} title={gif.title} />
                          ) : (
                            <Image
                              src={`/gifs/${gif.file}`}
                              alt={gif.title}
                              width={145}
                              height={145}
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
                          {gif.source && (
                            <p
                              className="card-text small text-muted mb-0"
                              style={{ fontSize: '11px' }}
                            >
                              {gif.url ? (
                                <a href={gif.url} target="_blank" rel="noreferrer">
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
                          <a
                            href={`/gifs/${gif.file}`}
                            download
                            className="btn btn-sm btn-success"
                            title="Download file"
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
              <div className="text-center my-4">
                <button
                  type="button"
                  className="btn btn-outline-primary"
                  onClick={() => setShown(shown + PAGE_SIZE)}
                >
                  Show more ({filteredGifs.length - shown} left)
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
