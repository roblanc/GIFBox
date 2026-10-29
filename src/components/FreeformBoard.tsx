'use client';

import React, { useCallback, useEffect, useRef, useState } from 'react';

export interface LibraryGifInput {
  id: number;
  slug?: string;
  title: string;
  category: string;
  file: string;
  type?: string;
  srcUrl?: string;
  originalUrl?: string;
  cutoutUrl?: string;
}

export interface BoardMediaItem {
  id: string;
  assetId?: string;
  kind: 'gif' | 'video' | 'image' | 'text';
  src: string;
  originalSrc?: string;
  cutoutSrc?: string;
  title: string;
  x: number;
  y: number;
  width: number;
  height: number;
  rotation: number;
  zIndex: number;
  opacity: number;
  flipX: boolean;
  locked: boolean;
  // Non-destructive crop percentages (0..1 of natural media dimensions)
  cropX: number;
  cropY: number;
  cropW: number;
  cropH: number;
  // For text items
  text?: string;
  color?: string;
  bgColor?: string;
  fontSize?: number;
}

export interface Point {
  x: number;
  y: number;
}

export interface BoardStroke {
  id: string;
  tool: 'marker' | 'highlighter' | 'arrow' | 'rect' | 'ellipse';
  color: string;
  size: number;
  points: Point[];
}

interface LaserTrailPoint {
  x: number;
  y: number;
  t: number;
}

type ToolKind =
  | 'select'
  | 'hand'
  | 'marker'
  | 'highlighter'
  | 'laser'
  | 'arrow'
  | 'rect'
  | 'ellipse'
  | 'text'
  | 'eraser';

type BgTheme = 'dark-grid' | 'light-grid' | 'dark-solid' | 'light-solid';

interface HistorySnapshot {
  items: BoardMediaItem[];
  strokes: BoardStroke[];
}

interface FreeformBoardProps {
  pendingItem: LibraryGifInput | null;
  onPendingConsumed: () => void;
  splitMode: 'split' | 'library' | 'board';
  onChangeSplitMode: (mode: 'split' | 'library' | 'board') => void;
}

const STORAGE_KEY = 'gifbox_freeform_board_v1';

const COLORS = [
  '#ff3b30', // Red
  '#ffcc00', // Yellow
  '#34c759', // Green
  '#00d2ff', // Cyan
  '#af52de', // Purple
  '#ff2d55', // Pink
  '#ffffff', // White
  '#111111', // Black
];

const SIZES = [
  { label: 'S', value: 3 },
  { label: 'M', value: 6 },
  { label: 'L', value: 12 },
  { label: 'XL', value: 22 },
];

function uid(): string {
  return `${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 8)}`;
}

function pointsToSvgPath(pts: Point[]): string {
  if (pts.length === 0) return '';
  if (pts.length === 1) {
    const p = pts[0];
    return `M ${p.x} ${p.y} L ${p.x + 0.1} ${p.y + 0.1}`;
  }
  let d = `M ${pts[0].x.toFixed(1)} ${pts[0].y.toFixed(1)}`;
  for (let i = 1; i < pts.length - 1; i++) {
    const midX = (pts[i].x + pts[i + 1].x) / 2;
    const midY = (pts[i].y + pts[i + 1].y) / 2;
    d += ` Q ${pts[i].x.toFixed(1)} ${pts[i].y.toFixed(1)} ${midX.toFixed(1)} ${midY.toFixed(1)}`;
  }
  const last = pts[pts.length - 1];
  d += ` L ${last.x.toFixed(1)} ${last.y.toFixed(1)}`;
  return d;
}

export default function FreeformBoard({
  pendingItem,
  onPendingConsumed,
  splitMode,
  onChangeSplitMode,
}: FreeformBoardProps) {
  const viewportRef = useRef<HTMLDivElement>(null);
  const fileInputRef = useRef<HTMLInputElement>(null);
  const mediaElementsRef = useRef<Map<string, HTMLImageElement | HTMLVideoElement>>(new Map());

  const [items, setItems] = useState<BoardMediaItem[]>([]);
  const [strokes, setStrokes] = useState<BoardStroke[]>([]);
  const [history, setHistory] = useState<HistorySnapshot[]>([]);
  const [redoStack, setRedoStack] = useState<HistorySnapshot[]>([]);

  const [selectedId, setSelectedId] = useState<string | null>(null);
  const [croppingId, setCroppingId] = useState<string | null>(null);
  const [editingTextId, setEditingTextId] = useState<string | null>(null);

  const [tool, setTool] = useState<ToolKind>('select');
  const [color, setColor] = useState<string>('#ff3b30');
  const [strokeSize, setStrokeSize] = useState<number>(6);
  const [bgTheme, setBgTheme] = useState<BgTheme>('dark-grid');
  const [drawingsOnTop, setDrawingsOnTop] = useState<boolean>(true);

  const [pan, setPan] = useState<Point>({ x: 0, y: 0 });
  const [zoom, setZoom] = useState<number>(1);
  const [spacePressed, setSpacePressed] = useState<boolean>(false);
  const [isDragOver, setIsDragOver] = useState<boolean>(false);

  // Active interaction state
  const [activeStroke, setActiveStroke] = useState<BoardStroke | null>(null);
  const activeStrokeRef = useRef<BoardStroke | null>(null);
  const [laserPoints, setLaserPoints] = useState<LaserTrailPoint[]>([]);
  const [isRecording, setIsRecording] = useState<boolean>(false);
  const [toastMessage, setToastMessage] = useState<string | null>(null);
  const recorderRef = useRef<MediaRecorder | null>(null);
  const recordAnimRef = useRef<number | null>(null);

  const showToast = useCallback((msg: string) => {
    setToastMessage(msg);
    window.setTimeout(() => {
      setToastMessage((curr) => (curr === msg ? null : curr));
    }, 2800);
  }, []);

  const dragStateRef = useRef<{
    mode:
      | 'pan'
      | 'move-item'
      | 'resize-item'
      | 'rotate-item'
      | 'crop-item'
      | 'draw'
      | 'erase'
      | 'laser'
      | null;
    startClientX: number;
    startClientY: number;
    startPanX: number;
    startPanY: number;
    itemId?: string;
    handle?: string;
    initialItem?: BoardMediaItem;
    snapshotSaved?: boolean;
  }>({
    mode: null,
    startClientX: 0,
    startClientY: 0,
    startPanX: 0,
    startPanY: 0,
  });

  // Load saved board on mount (prioritize shared ?board= URL parameter if present)
  useEffect(() => {
    try {
      const params = new URLSearchParams(window.location.search);
      const sharedBoard = params.get('board');
      if (sharedBoard) {
        const jsonStr = decodeURIComponent(escape(window.atob(sharedBoard.replace(/-/g, '+').replace(/_/g, '/'))));
        const parsed = JSON.parse(jsonStr) as {
          items?: BoardMediaItem[];
          strokes?: BoardStroke[];
          bgTheme?: BgTheme;
        };
        if (Array.isArray(parsed.items)) setItems(parsed.items);
        if (Array.isArray(parsed.strokes)) setStrokes(parsed.strokes);
        if (parsed.bgTheme) setBgTheme(parsed.bgTheme);
        return;
      }

      const raw = localStorage.getItem(STORAGE_KEY);
      if (raw) {
        const parsed = JSON.parse(raw) as {
          items?: BoardMediaItem[];
          strokes?: BoardStroke[];
          bgTheme?: BgTheme;
        };
        if (Array.isArray(parsed.items)) setItems(parsed.items);
        if (Array.isArray(parsed.strokes)) setStrokes(parsed.strokes);
        if (parsed.bgTheme) setBgTheme(parsed.bgTheme);
      }
    } catch {
      // ignore corrupted localStorage or query param
    }
  }, []);

  // Persist board changes
  useEffect(() => {
    try {
      // Only persist non-blob URLs or reasonably sized data URLs
      const serializableItems = items.filter((it) => it.src.length < 500_000);
      localStorage.setItem(
        STORAGE_KEY,
        JSON.stringify({ items: serializableItems, strokes, bgTheme })
      );
    } catch {
      // ignore quota errors
    }
  }, [items, strokes, bgTheme]);

  const pushHistory = useCallback(
    (currItems: BoardMediaItem[], currStrokes: BoardStroke[]) => {
      setHistory((prev) => [...prev.slice(-29), { items: currItems, strokes: currStrokes }]);
      setRedoStack([]);
    },
    []
  );

  const handleUndo = useCallback(() => {
    setHistory((prev) => {
      if (prev.length === 0) return prev;
      const last = prev[prev.length - 1];
      setRedoStack((r) => [...r, { items, strokes }]);
      setItems(last.items);
      setStrokes(last.strokes);
      return prev.slice(0, -1);
    });
  }, [items, strokes]);

  const handleRedo = useCallback(() => {
    setRedoStack((prev) => {
      if (prev.length === 0) return prev;
      const next = prev[prev.length - 1];
      setHistory((h) => [...h, { items, strokes }]);
      setItems(next.items);
      setStrokes(next.strokes);
      return prev.slice(0, -1);
    });
  }, [items, strokes]);

  // Convert screen coordinates to board world coordinates
  const clientToWorld = useCallback(
    (clientX: number, clientY: number): Point => {
      const rect = viewportRef.current?.getBoundingClientRect();
      if (!rect) return { x: 0, y: 0 };
      return {
        x: (clientX - rect.left - pan.x) / zoom,
        y: (clientY - rect.top - pan.y) / zoom,
      };
    },
    [pan.x, pan.y, zoom]
  );

  // Add a media item onto the board
  const addMediaItem = useCallback(
    (
      input: {
        assetId?: string;
        kind: 'gif' | 'video' | 'image' | 'text';
        src: string;
        originalSrc?: string;
        cutoutSrc?: string;
        title: string;
        width?: number;
        height?: number;
        text?: string;
      },
      worldPos?: Point
    ) => {
      const rect = viewportRef.current?.getBoundingClientRect();
      const centerWorld: Point = worldPos || {
        x: ((rect ? rect.width / 2 : 400) - pan.x) / zoom + (Math.random() - 0.5) * 40,
        y: ((rect ? rect.height / 2 : 300) - pan.y) / zoom + (Math.random() - 0.5) * 40,
      };
      const w = input.width || (input.kind === 'text' ? 220 : 260);
      const h = input.height || (input.kind === 'text' ? 70 : 220);

      setItems((prev) => {
        pushHistory(prev, strokes);
        const maxZ = prev.reduce((m, it) => Math.max(m, it.zIndex), 0);
        const newItem: BoardMediaItem = {
          id: uid(),
          assetId: input.assetId,
          kind: input.kind,
          src: input.src,
          originalSrc: input.originalSrc,
          cutoutSrc: input.cutoutSrc,
          title: input.title,
          x: centerWorld.x - w / 2,
          y: centerWorld.y - h / 2,
          width: w,
          height: h,
          rotation: 0,
          zIndex: maxZ + 1,
          opacity: 1,
          flipX: false,
          locked: false,
          cropX: 0,
          cropY: 0,
          cropW: 1,
          cropH: 1,
          text: input.text,
          color: color,
          bgColor: 'rgba(17, 19, 26, 0.85)',
          fontSize: 22,
        };
        setSelectedId(newItem.id);
        if (input.kind === 'text') {
          setEditingTextId(newItem.id);
        }
        return [...prev, newItem];
      });
    },
    [color, pan.x, pan.y, pushHistory, strokes, zoom]
  );

  // Consume item clicked via "+ Board" from the left library
  useEffect(() => {
    if (!pendingItem) return;
    const src = pendingItem.srcUrl || `/gifs/${pendingItem.file}`;
    const isVideo =
      pendingItem.type === 'video' ||
      src.toLowerCase().endsWith('.mp4') ||
      src.toLowerCase().endsWith('.webm');
    addMediaItem({
      assetId: pendingItem.slug,
      kind: isVideo ? 'video' : pendingItem.type === 'image' ? 'image' : 'gif',
      src,
      originalSrc: pendingItem.originalUrl,
      cutoutSrc: pendingItem.cutoutUrl,
      title: pendingItem.title,
    });
    onPendingConsumed();
  }, [pendingItem, addMediaItem, onPendingConsumed]);

  // Laser trail decay timer
  useEffect(() => {
    if (laserPoints.length === 0) return;
    const id = window.setInterval(() => {
      const now = performance.now();
      setLaserPoints((prev) => prev.filter((pt) => now - pt.t < 1200));
    }, 50);
    return () => window.clearInterval(id);
  }, [laserPoints.length]);

  // Keyboard shortcuts
  useEffect(() => {
    const onKeyDown = (e: KeyboardEvent) => {
      const target = e.target as HTMLElement | null;
      const isInput =
        target &&
        (target.tagName === 'INPUT' ||
          target.tagName === 'TEXTAREA' ||
          target.isContentEditable);
      if (isInput) return;

      if (e.code === 'Space') {
        setSpacePressed(true);
      } else if ((e.metaKey || e.ctrlKey) && e.key.toLowerCase() === 'z') {
        e.preventDefault();
        if (e.shiftKey) handleRedo();
        else handleUndo();
      } else if ((e.metaKey || e.ctrlKey) && e.key.toLowerCase() === 'd') {
        if (selectedId) {
          e.preventDefault();
          setItems((prev) => {
            const found = prev.find((it) => it.id === selectedId);
            if (!found) return prev;
            pushHistory(prev, strokes);
            const maxZ = prev.reduce((m, it) => Math.max(m, it.zIndex), 0);
            const copy: BoardMediaItem = {
              ...found,
              id: uid(),
              x: found.x + 28,
              y: found.y + 28,
              zIndex: maxZ + 1,
            };
            setSelectedId(copy.id);
            return [...prev, copy];
          });
        }
      } else if (e.key === 'Backspace' || e.key === 'Delete') {
        if (selectedId && !editingTextId) {
          e.preventDefault();
          setItems((prev) => {
            pushHistory(prev, strokes);
            return prev.filter((it) => it.id !== selectedId);
          });
          setSelectedId(null);
          setCroppingId(null);
        }
      } else if (e.key === 'Escape') {
        setCroppingId(null);
        setEditingTextId(null);
        setSelectedId(null);
        setTool('select');
      } else if (!e.metaKey && !e.ctrlKey) {
        const k = e.key.toLowerCase();
        if (k === 'v') setTool('select');
        else if (k === 'h') setTool('hand');
        else if (k === 'p') setTool('marker');
        else if (k === 'm') setTool('highlighter');
        else if (k === 'l') setTool('laser');
        else if (k === 'a') setTool('arrow');
        else if (k === 'r') setTool('rect');
        else if (k === 'o') setTool('ellipse');
        else if (k === 't') setTool('text');
        else if (k === 'e') setTool('eraser');
      }
    };
    const onKeyUp = (e: KeyboardEvent) => {
      if (e.code === 'Space') setSpacePressed(false);
    };
    window.addEventListener('keydown', onKeyDown);
    window.addEventListener('keyup', onKeyUp);
    return () => {
      window.removeEventListener('keydown', onKeyDown);
      window.removeEventListener('keyup', onKeyUp);
    };
  }, [editingTextId, handleRedo, handleUndo, pushHistory, selectedId, strokes]);

  // Support pasting images from clipboard
  useEffect(() => {
    const onPaste = (e: ClipboardEvent) => {
      const files = e.clipboardData?.files;
      if (!files || files.length === 0) return;
      Array.from(files).forEach((file) => {
        if (file.type.startsWith('image/') || file.type.startsWith('video/')) {
          const url = URL.createObjectURL(file);
          addMediaItem({
            kind: file.type.startsWith('video/')
              ? 'video'
              : file.type === 'image/gif'
              ? 'gif'
              : 'image',
            src: url,
            title: file.name || 'Pasted Media',
          });
        }
      });
    };
    window.addEventListener('paste', onPaste);
    return () => window.removeEventListener('paste', onPaste);
  }, [addMediaItem]);

  // Erase strokes near world point (supports freehand paths, arrows, boxes, and circles)
  const eraseAtPoint = useCallback(
    (pt: Point) => {
      const distToSegment = (p: Point, a: Point, b: Point) => {
        const dx = b.x - a.x;
        const dy = b.y - a.y;
        const lenSq = dx * dx + dy * dy;
        if (lenSq === 0) return Math.hypot(p.x - a.x, p.y - a.y);
        const t = Math.max(0, Math.min(1, ((p.x - a.x) * dx + (p.y - a.y) * dy) / lenSq));
        return Math.hypot(p.x - (a.x + t * dx), p.y - (a.y + t * dy));
      };

      const isStrokeHit = (s: BoardStroke): boolean => {
        const threshold = (18 + s.size / 2) / zoom;
        if (s.points.length === 0) return false;
        if (s.points.length === 1) {
          return Math.hypot(s.points[0].x - pt.x, s.points[0].y - pt.y) <= threshold;
        }
        if ((s.tool === 'rect' || s.tool === 'ellipse') && s.points.length >= 2) {
          const p0 = s.points[0];
          const p1 = s.points[s.points.length - 1];
          const minX = Math.min(p0.x, p1.x);
          const maxX = Math.max(p0.x, p1.x);
          const minY = Math.min(p0.y, p1.y);
          const maxY = Math.max(p0.y, p1.y);
          const corners: [Point, Point][] = [
            [{ x: minX, y: minY }, { x: maxX, y: minY }],
            [{ x: maxX, y: minY }, { x: maxX, y: maxY }],
            [{ x: maxX, y: maxY }, { x: minX, y: maxY }],
            [{ x: minX, y: maxY }, { x: minX, y: minY }],
          ];
          return corners.some(([a, b]) => distToSegment(pt, a, b) <= threshold);
        }
        for (let i = 0; i < s.points.length - 1; i++) {
          if (distToSegment(pt, s.points[i], s.points[i + 1]) <= threshold) {
            return true;
          }
        }
        return false;
      };

      setStrokes((prev) => {
        const remaining = prev.filter((s) => !isStrokeHit(s));
        if (remaining.length !== prev.length && !dragStateRef.current.snapshotSaved) {
          pushHistory(items, prev);
          dragStateRef.current.snapshotSaved = true;
        }
        return remaining;
      });
    },
    [items, pushHistory, zoom]
  );

  // Pointer down on the board background or drawing surface
  const handleBoardPointerDown = (e: React.PointerEvent<HTMLDivElement>) => {
    if (e.button === 1 || spacePressed || tool === 'hand') {
      e.currentTarget.setPointerCapture(e.pointerId);
      dragStateRef.current = {
        mode: 'pan',
        startClientX: e.clientX,
        startClientY: e.clientY,
        startPanX: pan.x,
        startPanY: pan.y,
      };
      return;
    }

    const worldPt = clientToWorld(e.clientX, e.clientY);

    if (tool === 'text') {
      addMediaItem(
        {
          kind: 'text',
          src: '',
          title: 'Text Note',
          text: 'Double-click to edit',
          width: 240,
          height: 64,
        },
        worldPt
      );
      setTool('select');
      return;
    }

    if (tool === 'laser') {
      e.currentTarget.setPointerCapture(e.pointerId);
      dragStateRef.current = {
        mode: 'laser',
        startClientX: e.clientX,
        startClientY: e.clientY,
        startPanX: pan.x,
        startPanY: pan.y,
      };
      setLaserPoints((prev) => [...prev, { x: worldPt.x, y: worldPt.y, t: performance.now() }]);
      return;
    }

    if (tool === 'eraser') {
      e.currentTarget.setPointerCapture(e.pointerId);
      dragStateRef.current = {
        mode: 'erase',
        startClientX: e.clientX,
        startClientY: e.clientY,
        startPanX: pan.x,
        startPanY: pan.y,
        snapshotSaved: false,
      };
      eraseAtPoint(worldPt);
      return;
    }

    if (
      tool === 'marker' ||
      tool === 'highlighter' ||
      tool === 'arrow' ||
      tool === 'rect' ||
      tool === 'ellipse'
    ) {
      e.currentTarget.setPointerCapture(e.pointerId);
      dragStateRef.current = {
        mode: 'draw',
        startClientX: e.clientX,
        startClientY: e.clientY,
        startPanX: pan.x,
        startPanY: pan.y,
      };
      const newStroke: BoardStroke = {
        id: uid(),
        tool,
        color,
        size: tool === 'highlighter' ? Math.max(18, strokeSize * 2.6) : strokeSize,
        points: [worldPt, worldPt],
      };
      activeStrokeRef.current = newStroke;
      setActiveStroke(newStroke);
      return;
    }

    // In select mode, clicking empty canvas deselects
    if (e.target === e.currentTarget || (e.target as HTMLElement).dataset.boardBg === 'true') {
      setSelectedId(null);
      setCroppingId(null);
      setEditingTextId(null);
    }
  };

  // Pointer down on an item
  const handleItemPointerDown = (e: React.PointerEvent, item: BoardMediaItem) => {
    if (spacePressed || tool === 'hand' || e.button === 1) return;
    if (
      tool === 'marker' ||
      tool === 'highlighter' ||
      tool === 'laser' ||
      tool === 'arrow' ||
      tool === 'rect' ||
      tool === 'ellipse' ||
      tool === 'text' ||
      tool === 'eraser'
    ) {
      // Let the event bubble to the board drawing handler so you can draw/caption directly over GIFs!
      return;
    }

    e.stopPropagation();
    setSelectedId(item.id);
    if (croppingId && croppingId !== item.id) {
      setCroppingId(null);
    }
    if (editingTextId && editingTextId !== item.id) {
      setEditingTextId(null);
    }
    if (item.locked || croppingId === item.id) return;

    (e.currentTarget as HTMLElement).setPointerCapture(e.pointerId);
    dragStateRef.current = {
      mode: 'move-item',
      startClientX: e.clientX,
      startClientY: e.clientY,
      startPanX: pan.x,
      startPanY: pan.y,
      itemId: item.id,
      initialItem: { ...item },
      snapshotSaved: false,
    };
  };

  // Pointer down on resize / rotate / crop handle
  const handleTransformPointerDown = (
    e: React.PointerEvent,
    item: BoardMediaItem,
    mode: 'resize-item' | 'rotate-item' | 'crop-item',
    handle: string
  ) => {
    e.stopPropagation();
    e.preventDefault();
    (e.currentTarget as HTMLElement).setPointerCapture(e.pointerId);
    dragStateRef.current = {
      mode,
      startClientX: e.clientX,
      startClientY: e.clientY,
      startPanX: pan.x,
      startPanY: pan.y,
      itemId: item.id,
      handle,
      initialItem: { ...item },
      snapshotSaved: false,
    };
  };

  const handlePointerMove = (e: React.PointerEvent) => {
    const st = dragStateRef.current;
    if (!st.mode) return;

    if (st.mode === 'pan') {
      const dx = e.clientX - st.startClientX;
      const dy = e.clientY - st.startClientY;
      setPan({ x: st.startPanX + dx, y: st.startPanY + dy });
      return;
    }

    const worldPt = clientToWorld(e.clientX, e.clientY);

    if (st.mode === 'laser') {
      setLaserPoints((prev) => [...prev, { x: worldPt.x, y: worldPt.y, t: performance.now() }]);
      return;
    }

    if (st.mode === 'erase') {
      eraseAtPoint(worldPt);
      return;
    }

    if (st.mode === 'draw' && activeStrokeRef.current) {
      const curr = activeStrokeRef.current;
      const nextStroke: BoardStroke =
        curr.tool === 'arrow' || curr.tool === 'rect' || curr.tool === 'ellipse'
          ? {
              ...curr,
              points: [curr.points[0], worldPt],
            }
          : {
              ...curr,
              points: [...curr.points, worldPt],
            };
      activeStrokeRef.current = nextStroke;
      setActiveStroke(nextStroke);
      return;
    }

    const init = st.initialItem;
    if (!init || !st.itemId) return;

    const dx = (e.clientX - st.startClientX) / zoom;
    const dy = (e.clientY - st.startClientY) / zoom;

    if (!st.snapshotSaved && (Math.abs(dx) > 1 || Math.abs(dy) > 1)) {
      pushHistory(items, strokes);
      st.snapshotSaved = true;
    }

    if (st.mode === 'move-item') {
      setItems((prev) =>
        prev.map((it) => (it.id === st.itemId ? { ...it, x: init.x + dx, y: init.y + dy } : it))
      );
      return;
    }

    if (st.mode === 'rotate-item') {
      const cx = init.x + init.width / 2;
      const cy = init.y + init.height / 2;
      const angleRad = Math.atan2(worldPt.y - cy, worldPt.x - cx);
      let deg = (angleRad * 180) / Math.PI + 90;
      if (e.shiftKey) {
        deg = Math.round(deg / 15) * 15;
      }
      setItems((prev) =>
        prev.map((it) => (it.id === st.itemId ? { ...it, rotation: deg } : it))
      );
      return;
    }

    if (st.mode === 'resize-item' && st.handle) {
      const h = st.handle;
      let newX = init.x;
      let newY = init.y;
      let newW = init.width;
      let newH = init.height;
      const minSize = 40;

      if (h.includes('e')) newW = Math.max(minSize, init.width + dx);
      if (h.includes('s')) newH = Math.max(minSize, init.height + dy);
      if (h.includes('w')) {
        const possibleW = init.width - dx;
        if (possibleW >= minSize) {
          newW = possibleW;
          newX = init.x + dx;
        }
      }
      if (h.includes('n')) {
        const possibleH = init.height - dy;
        if (possibleH >= minSize) {
          newH = possibleH;
          newY = init.y + dy;
        }
      }

      // Hold Shift on corner handles to lock aspect ratio
      if (e.shiftKey && (h === 'se' || h === 'sw' || h === 'ne' || h === 'nw')) {
        const ratio = init.width / Math.max(1, init.height);
        newH = Math.max(minSize, newW / ratio);
      }

      setItems((prev) =>
        prev.map((it) =>
          it.id === st.itemId ? { ...it, x: newX, y: newY, width: newW, height: newH } : it
        )
      );
      return;
    }

    if (st.mode === 'crop-item' && st.handle) {
      const h = st.handle;
      const fullW = init.width / Math.max(0.05, init.cropW);
      const fullH = init.height / Math.max(0.05, init.cropH);
      const dCropX = dx / fullW;
      const dCropY = dy / fullH;

      let cX = init.cropX;
      let cY = init.cropY;
      let cW = init.cropW;
      let cH = init.cropH;
      const minC = 0.08;

      if (h.includes('e')) {
        cW = Math.min(1 - cX, Math.max(minC, init.cropW + dCropX));
      }
      if (h.includes('s')) {
        cH = Math.min(1 - cY, Math.max(minC, init.cropH + dCropY));
      }
      if (h.includes('w')) {
        const nextX = Math.max(0, Math.min(init.cropX + init.cropW - minC, init.cropX + dCropX));
        cW = init.cropW + (init.cropX - nextX);
        cX = nextX;
      }
      if (h.includes('n')) {
        const nextY = Math.max(0, Math.min(init.cropY + init.cropH - minC, init.cropY + dCropY));
        cH = init.cropH + (init.cropY - nextY);
        cY = nextY;
      }

      const newX = init.x + (cX - init.cropX) * fullW;
      const newY = init.y + (cY - init.cropY) * fullH;
      const newW = cW * fullW;
      const newH = cH * fullH;

      setItems((prev) =>
        prev.map((it) =>
          it.id === st.itemId
            ? {
                ...it,
                x: newX,
                y: newY,
                width: newW,
                height: newH,
                cropX: cX,
                cropY: cY,
                cropW: cW,
                cropH: cH,
              }
            : it
        )
      );
    }
  };

  const handlePointerUp = () => {
    if (dragStateRef.current.mode === 'draw' && activeStrokeRef.current) {
      const finished = activeStrokeRef.current;
      pushHistory(items, strokes);
      setStrokes((prev) => [...prev, finished]);
      activeStrokeRef.current = null;
      setActiveStroke(null);
    }
    dragStateRef.current.mode = null;
  };

  // Wheel pan & zoom
  const handleWheel = (e: React.WheelEvent<HTMLDivElement>) => {
    if (e.ctrlKey || e.metaKey) {
      e.preventDefault();
      const rect = viewportRef.current?.getBoundingClientRect();
      if (!rect) return;
      const cursorX = e.clientX - rect.left;
      const cursorY = e.clientY - rect.top;
      const factor = e.deltaY < 0 ? 1.1 : 0.9;
      const nextZoom = Math.min(3, Math.max(0.25, zoom * factor));
      const nextPanX = cursorX - ((cursorX - pan.x) / zoom) * nextZoom;
      const nextPanY = cursorY - ((cursorY - pan.y) / zoom) * nextZoom;
      setZoom(nextZoom);
      setPan({ x: nextPanX, y: nextPanY });
    } else {
      setPan((prev) => ({ x: prev.x - e.deltaX, y: prev.y - e.deltaY }));
    }
  };

  // Drag and drop from Left Library or local files
  const handleDragOver = (e: React.DragEvent<HTMLDivElement>) => {
    e.preventDefault();
    e.dataTransfer.dropEffect = 'copy';
    if (!isDragOver) setIsDragOver(true);
  };

  const handleDragLeave = () => {
    setIsDragOver(false);
  };

  const handleDrop = (e: React.DragEvent<HTMLDivElement>) => {
    e.preventDefault();
    setIsDragOver(false);
    const dropPos = clientToWorld(e.clientX, e.clientY);

    // 1. Check custom GIFBox library payload
    const rawGifbox = e.dataTransfer.getData('application/x-gifbox-item');
    if (rawGifbox) {
      try {
        const parsed = JSON.parse(rawGifbox) as LibraryGifInput;
        const src = parsed.srcUrl || `/gifs/${parsed.file}`;
        const isVideo =
          parsed.type === 'video' ||
          src.toLowerCase().endsWith('.mp4') ||
          src.toLowerCase().endsWith('.webm');
        addMediaItem(
          {
            assetId: parsed.slug,
            kind: isVideo ? 'video' : parsed.type === 'image' ? 'image' : 'gif',
            src,
            originalSrc: parsed.originalUrl,
            cutoutSrc: parsed.cutoutUrl,
            title: parsed.title,
          },
          dropPos
        );
        return;
      } catch {
        // fallback below
      }
    }

    // 2. Check dropped files from OS Finder/Desktop
    if (e.dataTransfer.files && e.dataTransfer.files.length > 0) {
      Array.from(e.dataTransfer.files).forEach((file, idx) => {
        if (file.type.startsWith('image/') || file.type.startsWith('video/')) {
          const url = URL.createObjectURL(file);
          addMediaItem(
            {
              kind: file.type.startsWith('video/')
                ? 'video'
                : file.type === 'image/gif'
                ? 'gif'
                : 'image',
              src: url,
              title: file.name,
            },
            { x: dropPos.x + idx * 24, y: dropPos.y + idx * 24 }
          );
        }
      });
      return;
    }

    // 3. Check plain URL drop
    const uri = e.dataTransfer.getData('text/uri-list') || e.dataTransfer.getData('text/plain');
    if (uri && (uri.startsWith('http') || uri.startsWith('/'))) {
      const lower = uri.toLowerCase();
      const isVid = lower.endsWith('.mp4') || lower.endsWith('.webm');
      addMediaItem(
        {
          kind: isVid ? 'video' : 'gif',
          src: uri,
          title: uri.split('/').pop() || 'Dropped Media',
        },
        dropPos
      );
    }
  };

  // Layer ordering helpers
  const changeLayer = (id: string, dir: 'front' | 'back' | 'forward' | 'backward') => {
    setItems((prev) => {
      pushHistory(prev, strokes);
      const target = prev.find((it) => it.id === id);
      if (!target) return prev;
      const maxZ = prev.reduce((m, it) => Math.max(m, it.zIndex), 0);
      const minZ = prev.reduce((m, it) => Math.min(m, it.zIndex), maxZ);
      return prev.map((it) => {
        if (it.id !== id) return it;
        if (dir === 'front') return { ...it, zIndex: maxZ + 1 };
        if (dir === 'back') return { ...it, zIndex: minZ - 1 };
        if (dir === 'forward') return { ...it, zIndex: it.zIndex + 1 };
        return { ...it, zIndex: it.zIndex - 1 };
      });
    });
  };

  const resetCrop = (id: string) => {
    setItems((prev) => {
      pushHistory(prev, strokes);
      return prev.map((it) => {
        if (it.id !== id) return it;
        const fullW = it.width / Math.max(0.05, it.cropW);
        const fullH = it.height / Math.max(0.05, it.cropH);
        return {
          ...it,
          x: it.x - it.cropX * fullW,
          y: it.y - it.cropY * fullH,
          width: fullW,
          height: fullH,
          cropX: 0,
          cropY: 0,
          cropW: 1,
          cropH: 1,
        };
      });
    });
  };

  // Render the board into a 2D canvas context for PNG export or WebM video recording
  const renderBoardToCanvas = useCallback(
    (ctx: CanvasRenderingContext2D, width: number, height: number) => {
      ctx.save();
      // Background fill
      const isDark = bgTheme === 'dark-grid' || bgTheme === 'dark-solid';
      ctx.fillStyle = isDark ? '#121318' : '#f8f9fa';
      ctx.fillRect(0, 0, width, height);

      if (bgTheme.endsWith('grid')) {
        ctx.fillStyle = isDark ? 'rgba(255,255,255,0.12)' : 'rgba(0,0,0,0.12)';
        const step = 24 * zoom;
        const offsetX = ((pan.x % step) + step) % step;
        const offsetY = ((pan.y % step) + step) % step;
        for (let x = offsetX; x < width; x += step) {
          for (let y = offsetY; y < height; y += step) {
            ctx.fillRect(x, y, 1.5, 1.5);
          }
        }
      }

      ctx.translate(pan.x, pan.y);
      ctx.scale(zoom, zoom);

      const drawStrokesLayer = () => {
        const allStrokes = activeStroke ? [...strokes, activeStroke] : strokes;
        for (const s of allStrokes) {
          if (s.points.length < 1) continue;
          ctx.save();
          ctx.strokeStyle = s.color;
          ctx.fillStyle = s.color;
          ctx.lineWidth = s.size;
          ctx.lineCap = 'round';
          ctx.lineJoin = 'round';
          ctx.globalAlpha = s.tool === 'highlighter' ? 0.42 : 1;

          if (s.tool === 'marker' || s.tool === 'highlighter') {
            const p2d = new Path2D(pointsToSvgPath(s.points));
            ctx.stroke(p2d);
          } else if (s.tool === 'rect' && s.points.length >= 2) {
            const p0 = s.points[0];
            const p1 = s.points[s.points.length - 1];
            ctx.strokeRect(
              Math.min(p0.x, p1.x),
              Math.min(p0.y, p1.y),
              Math.abs(p1.x - p0.x),
              Math.abs(p1.y - p0.y)
            );
          } else if (s.tool === 'ellipse' && s.points.length >= 2) {
            const p0 = s.points[0];
            const p1 = s.points[s.points.length - 1];
            const cx = (p0.x + p1.x) / 2;
            const cy = (p0.y + p1.y) / 2;
            const rx = Math.abs(p1.x - p0.x) / 2;
            const ry = Math.abs(p1.y - p0.y) / 2;
            ctx.beginPath();
            ctx.ellipse(cx, cy, rx, ry, 0, 0, Math.PI * 2);
            ctx.stroke();
          } else if (s.tool === 'arrow' && s.points.length >= 2) {
            const p0 = s.points[0];
            const p1 = s.points[s.points.length - 1];
            ctx.beginPath();
            ctx.moveTo(p0.x, p0.y);
            ctx.lineTo(p1.x, p1.y);
            ctx.stroke();
            const angle = Math.atan2(p1.y - p0.y, p1.x - p0.x);
            const headLen = Math.max(14, s.size * 2.8);
            ctx.beginPath();
            ctx.moveTo(p1.x, p1.y);
            ctx.lineTo(
              p1.x - headLen * Math.cos(angle - Math.PI / 6),
              p1.y - headLen * Math.sin(angle - Math.PI / 6)
            );
            ctx.lineTo(
              p1.x - headLen * Math.cos(angle + Math.PI / 6),
              p1.y - headLen * Math.sin(angle + Math.PI / 6)
            );
            ctx.closePath();
            ctx.fill();
          }
          ctx.restore();
        }
      };

      if (!drawingsOnTop) drawStrokesLayer();

      const sortedItems = [...items].sort((a, b) => a.zIndex - b.zIndex);
      for (const it of sortedItems) {
        ctx.save();
        ctx.globalAlpha = it.opacity;
        const cx = it.x + it.width / 2;
        const cy = it.y + it.height / 2;
        ctx.translate(cx, cy);
        ctx.rotate((it.rotation * Math.PI) / 180);
        if (it.flipX) ctx.scale(-1, 1);

        if (it.kind === 'text') {
          ctx.fillStyle = it.bgColor || 'rgba(17,19,26,0.85)';
          ctx.fillRect(-it.width / 2, -it.height / 2, it.width, it.height);
          ctx.fillStyle = it.color || '#ffffff';
          ctx.font = `600 ${it.fontSize || 22}px monospace`;
          ctx.textBaseline = 'middle';
          ctx.fillText(it.text || '', -it.width / 2 + 12, 0);
        } else {
          const el = mediaElementsRef.current.get(it.id);
          if (el) {
            ctx.beginPath();
            ctx.rect(-it.width / 2, -it.height / 2, it.width, it.height);
            ctx.clip();
            const fullW = it.width / Math.max(0.05, it.cropW);
            const fullH = it.height / Math.max(0.05, it.cropH);
            const drawX = -it.width / 2 - it.cropX * fullW;
            const drawY = -it.height / 2 - it.cropY * fullH;
            try {
              ctx.drawImage(el, drawX, drawY, fullW, fullH);
            } catch {
              // ignore cross-origin or unready frame
            }
          }
        }
        ctx.restore();
      }

      if (drawingsOnTop) drawStrokesLayer();
      ctx.restore();
    },
    [activeStroke, bgTheme, drawingsOnTop, items, pan.x, pan.y, strokes, zoom]
  );

  const handleExportPng = () => {
    const rect = viewportRef.current?.getBoundingClientRect();
    if (!rect) return;
    const canvas = document.createElement('canvas');
    canvas.width = Math.round(rect.width * window.devicePixelRatio);
    canvas.height = Math.round(rect.height * window.devicePixelRatio);
    const ctx = canvas.getContext('2d');
    if (!ctx) return;
    ctx.scale(window.devicePixelRatio, window.devicePixelRatio);
    renderBoardToCanvas(ctx, rect.width, rect.height);
    const link = document.createElement('a');
    link.download = `gifbox-board-${Date.now()}.png`;
    link.href = canvas.toDataURL('image/png');
    link.click();
  };

  // Encode current board state into a shareable ?board= URL
  const getShareableBoardUrl = useCallback(() => {
    const origin =
      typeof window !== 'undefined' ? window.location.origin : 'https://gifbox.netlify.app';
    const serializableItems = items.filter((it) => !it.src.startsWith('blob:') && it.src.length < 100_000);
    const compactPayload = {
      items: serializableItems,
      strokes,
      bgTheme,
    };
    const b64 = window
      .btoa(unescape(encodeURIComponent(JSON.stringify(compactPayload))))
      .replace(/\+/g, '-')
      .replace(/\//g, '_')
      .replace(/=+$/, '');
    return `${origin}/?board=${b64}`;
  }, [bgTheme, items, strokes]);

  // Build structured AI storyboard payload (assets, positions, crops, arrows, notes)
  const buildAiBoardPayload = useCallback(() => {
    const origin =
      typeof window !== 'undefined' && window.location.origin.includes('http')
        ? 'https://gifbox.netlify.app'
        : 'https://gifbox.netlify.app';
    const sorted = [...items].sort((a, b) => a.zIndex - b.zIndex);

    const findItemAtPoint = (pt: Point) => {
      for (let i = sorted.length - 1; i >= 0; i--) {
        const it = sorted[i];
        const pad = 24;
        if (
          pt.x >= it.x - pad &&
          pt.x <= it.x + it.width + pad &&
          pt.y >= it.y - pad &&
          pt.y <= it.y + it.height + pad
        ) {
          return it.assetId || (it.kind === 'text' ? `note:${it.text}` : it.title);
        }
      }
      return null;
    };

    const mediaAssets = sorted
      .filter((it) => it.kind !== 'text')
      .map((it, idx) => {
        const fullUrl = it.src.startsWith('http')
          ? it.src
          : `${origin}${it.src.startsWith('/') ? '' : '/'}${it.src}`;
        const slugFromSrc = it.src
          .split('/')
          .pop()
          ?.replace(/\.[^.]+$/, '');
        return {
          layerOrder: idx + 1,
          id: it.assetId || slugFromSrc || it.id,
          title: it.title,
          type: it.kind,
          url: fullUrl,
          ...(it.cutoutSrc
            ? {
                backgroundRemoved: it.src === it.cutoutSrc,
                cutoutUrl: it.cutoutSrc,
                ...(it.originalSrc ? { originalUrl: it.originalSrc } : {}),
              }
            : {}),
          position: { x: Math.round(it.x), y: Math.round(it.y) },
          size: { width: Math.round(it.width), height: Math.round(it.height) },
          rotationDeg: Math.round(it.rotation),
          opacity: it.opacity,
          flipX: it.flipX,
          crop: {
            x: +it.cropX.toFixed(3),
            y: +it.cropY.toFixed(3),
            w: +it.cropW.toFixed(3),
            h: +it.cropH.toFixed(3),
          },
        };
      });

    const textNotes = sorted
      .filter((it) => it.kind === 'text')
      .map((it) => ({
        text: it.text || '',
        position: { x: Math.round(it.x), y: Math.round(it.y) },
        color: it.color,
      }));

    const arrows = strokes
      .filter((s) => s.tool === 'arrow' && s.points.length >= 2)
      .map((s) => {
        const fromPt = s.points[0];
        const toPt = s.points[s.points.length - 1];
        return {
          color: s.color,
          from: { x: Math.round(fromPt.x), y: Math.round(fromPt.y) },
          to: { x: Math.round(toPt.x), y: Math.round(toPt.y) },
          fromTarget: findItemAtPoint(fromPt),
          toTarget: findItemAtPoint(toPt),
        };
      });

    const shapesAndHighlights = strokes
      .filter((s) => s.tool !== 'arrow' && s.points.length >= 1)
      .map((s) => {
        const xs = s.points.map((p) => p.x);
        const ys = s.points.map((p) => p.y);
        const minX = Math.min(...xs);
        const maxX = Math.max(...xs);
        const minY = Math.min(...ys);
        const maxY = Math.max(...ys);
        const center = { x: (minX + maxX) / 2, y: (minY + maxY) / 2 };
        return {
          tool: s.tool,
          color: s.color,
          bounds: {
            x: Math.round(minX),
            y: Math.round(minY),
            width: Math.round(maxX - minX),
            height: Math.round(maxY - minY),
          },
          overTarget: findItemAtPoint(center),
        };
      });

    let shareUrl = origin;
    try {
      shareUrl = getShareableBoardUrl();
    } catch {
      // ignore if too large
    }

    return {
      schema: 'gifbox-board-v1',
      site: origin,
      catalogApi: `${origin}/api/catalog`,
      staticCatalogUrl: `${origin}/catalog.json`,
      boardLink: shareUrl,
      exportedAt: new Date().toISOString(),
      assets: mediaAssets,
      notes: textNotes,
      arrows,
      annotations: shapesAndHighlights,
    };
  }, [getShareableBoardUrl, items, strokes]);

  const handleCopyShareLink = async () => {
    try {
      const url = getShareableBoardUrl();
      window.history.replaceState(null, '', `/?board=${url.split('?board=')[1]}`);
      await navigator.clipboard.writeText(url);
      showToast('🔗 Saved Board Link copied to clipboard!');
    } catch {
      showToast('Could not copy board link');
    }
  };

  const handleCopyAiSpec = async () => {
    try {
      const payload = buildAiBoardPayload();
      const md = [
        `### GIFBox Board Spec (${payload.assets.length} assets, ${payload.notes.length} notes, ${payload.arrows.length} arrows)`,
        `Board URL: ${payload.boardLink}`,
        '```json',
        JSON.stringify(payload, null, 2),
        '```',
      ].join('\n');
      await navigator.clipboard.writeText(md);
      showToast('📋 Copied AI Board JSON + Prompt to clipboard!');
    } catch {
      showToast('Could not copy AI spec');
    }
  };

  const handleShareWithAi = async () => {
    const ts = Date.now();
    // 1. Export PNG
    const rect = viewportRef.current?.getBoundingClientRect();
    if (rect) {
      const canvas = document.createElement('canvas');
      canvas.width = Math.round(rect.width * window.devicePixelRatio);
      canvas.height = Math.round(rect.height * window.devicePixelRatio);
      const ctx = canvas.getContext('2d');
      if (ctx) {
        ctx.scale(window.devicePixelRatio, window.devicePixelRatio);
        renderBoardToCanvas(ctx, rect.width, rect.height);
        const pngLink = document.createElement('a');
        pngLink.download = `gifbox-board-${ts}.png`;
        pngLink.href = canvas.toDataURL('image/png');
        pngLink.click();
      }
    }

    // 2. Export JSON + Copy AI Markdown/JSON to clipboard
    const payload = buildAiBoardPayload();
    const jsonBlob = new Blob([JSON.stringify(payload, null, 2)], { type: 'application/json' });
    const jsonUrl = URL.createObjectURL(jsonBlob);
    const jsonLink = document.createElement('a');
    jsonLink.download = `gifbox-board-${ts}.json`;
    jsonLink.href = jsonUrl;
    jsonLink.click();

    try {
      const md = [
        `### GIFBox Board Spec (${payload.assets.length} assets, ${payload.notes.length} notes, ${payload.arrows.length} arrows)`,
        `Board URL: ${payload.boardLink}`,
        '```json',
        JSON.stringify(payload, null, 2),
        '```',
      ].join('\n');
      await navigator.clipboard.writeText(md);
    } catch {
      // ignore clipboard error
    }
    showToast('🤖 Downloaded PNG + JSON & copied AI spec to clipboard!');
  };

  const handleToggleRecording = () => {
    if (isRecording) {
      recorderRef.current?.stop();
      if (recordAnimRef.current) cancelAnimationFrame(recordAnimRef.current);
      setIsRecording(false);
      return;
    }

    const rect = viewportRef.current?.getBoundingClientRect();
    if (!rect) return;
    const canvas = document.createElement('canvas');
    canvas.width = Math.round(rect.width);
    canvas.height = Math.round(rect.height);
    const ctx = canvas.getContext('2d');
    if (!ctx) return;

    const stream = canvas.captureStream(30);
    const chunks: BlobPart[] = [];
    const recorder = new MediaRecorder(stream, {
      mimeType: MediaRecorder.isTypeSupported('video/webm;codecs=vp9')
        ? 'video/webm;codecs=vp9'
        : 'video/webm',
    });
    recorder.ondataavailable = (ev) => {
      if (ev.data.size > 0) chunks.push(ev.data);
    };
    recorder.onstop = () => {
      const blob = new Blob(chunks, { type: 'video/webm' });
      const url = URL.createObjectURL(blob);
      const a = document.createElement('a');
      a.href = url;
      a.download = `gifbox-board-${Date.now()}.webm`;
      a.click();
    };

    const renderLoop = () => {
      renderBoardToCanvas(ctx, canvas.width, canvas.height);
      recordAnimRef.current = requestAnimationFrame(renderLoop);
    };
    renderLoop();
    recorder.start();
    recorderRef.current = recorder;
    setIsRecording(true);
  };

  const selectedItem = items.find((it) => it.id === selectedId) || null;
  const sortedItems = [...items].sort((a, b) => a.zIndex - b.zIndex);
  const allStrokes = activeStroke ? [...strokes, activeStroke] : strokes;

  const bgStyle: React.CSSProperties = (() => {
    const step = `${24 * zoom}px ${24 * zoom}px`;
    const pos = `${pan.x}px ${pan.y}px`;
    if (bgTheme === 'dark-grid') {
      return {
        backgroundColor: '#121318',
        backgroundImage: 'radial-gradient(rgba(255,255,255,0.16) 1px, transparent 1px)',
        backgroundSize: step,
        backgroundPosition: pos,
      };
    }
    if (bgTheme === 'light-grid') {
      return {
        backgroundColor: '#f4f5f8',
        backgroundImage: 'radial-gradient(rgba(0,0,0,0.18) 1px, transparent 1px)',
        backgroundSize: step,
        backgroundPosition: pos,
      };
    }
    if (bgTheme === 'dark-solid') {
      return { backgroundColor: '#0b0c10' };
    }
    return { backgroundColor: '#ffffff' };
  })();

  const renderSvgAnnotations = (zIdx: number) => (
    <svg
      style={{
        position: 'absolute',
        inset: 0,
        width: '100%',
        height: '100%',
        overflow: 'visible',
        pointerEvents: 'none',
        zIndex: zIdx,
      }}
    >
      <g transform={`translate(${pan.x}, ${pan.y}) scale(${zoom})`}>
        {allStrokes.map((s) => {
          if (s.points.length === 0) return null;
          if (s.tool === 'marker' || s.tool === 'highlighter') {
            return (
              <path
                key={s.id}
                d={pointsToSvgPath(s.points)}
                fill="none"
                stroke={s.color}
                strokeWidth={s.size}
                strokeLinecap="round"
                strokeLinejoin="round"
                opacity={s.tool === 'highlighter' ? 0.42 : 1}
              />
            );
          }
          if (s.tool === 'arrow' && s.points.length >= 2) {
            const p0 = s.points[0];
            const p1 = s.points[s.points.length - 1];
            const dx = p1.x - p0.x;
            const dy = p1.y - p0.y;
            const dist = Math.hypot(dx, dy);
            const angle = Math.atan2(dy, dx);
            const headLen = Math.max(14, s.size * 3.2);
            const xA = p1.x - headLen * Math.cos(angle - Math.PI / 6);
            const yA = p1.y - headLen * Math.sin(angle - Math.PI / 6);
            const xB = p1.x - headLen * Math.cos(angle + Math.PI / 6);
            const yB = p1.y - headLen * Math.sin(angle + Math.PI / 6);
            return (
              <g key={s.id}>
                <line
                  x1={p0.x}
                  y1={p0.y}
                  x2={p1.x}
                  y2={p1.y}
                  stroke={s.color}
                  strokeWidth={s.size}
                  strokeLinecap="round"
                />
                {dist > 2 && (
                  <polygon
                    points={`${p1.x},${p1.y} ${xA},${yA} ${xB},${yB}`}
                    fill={s.color}
                  />
                )}
              </g>
            );
          }
          if (s.tool === 'rect' && s.points.length >= 2) {
            const p0 = s.points[0];
            const p1 = s.points[s.points.length - 1];
            return (
              <rect
                key={s.id}
                x={Math.min(p0.x, p1.x)}
                y={Math.min(p0.y, p1.y)}
                width={Math.max(1, Math.abs(p1.x - p0.x))}
                height={Math.max(1, Math.abs(p1.y - p0.y))}
                fill="none"
                stroke={s.color}
                strokeWidth={s.size}
                rx={4}
              />
            );
          }
          if (s.tool === 'ellipse' && s.points.length >= 2) {
            const p0 = s.points[0];
            const p1 = s.points[s.points.length - 1];
            return (
              <ellipse
                key={s.id}
                cx={(p0.x + p1.x) / 2}
                cy={(p0.y + p1.y) / 2}
                rx={Math.max(1, Math.abs(p1.x - p0.x) / 2)}
                ry={Math.max(1, Math.abs(p1.y - p0.y) / 2)}
                fill="none"
                stroke={s.color}
                strokeWidth={s.size}
              />
            );
          }
          return null;
        })}

        {/* Live Laser Pointer Trail */}
        {laserPoints.length > 1 && (
          <path
            d={pointsToSvgPath(laserPoints)}
            fill="none"
            stroke="#ff2d55"
            strokeWidth={6}
            strokeLinecap="round"
            strokeLinejoin="round"
            style={{ filter: 'drop-shadow(0 0 8px #ff2d55)' }}
          />
        )}
      </g>
    </svg>
  );

  return (
    <div
      style={{
        display: 'flex',
        flexDirection: 'column',
        width: '100%',
        height: '100%',
        userSelect: 'none',
        position: 'relative',
        overflow: 'hidden',
        background: '#16181f',
        color: '#f1f3f5',
      }}
    >
      {/* Top Studio Toolbar */}
      <div
        style={{
          display: 'flex',
          alignItems: 'center',
          justifyContent: 'space-between',
          gap: '8px',
          padding: '8px 12px',
          background: '#1c1f28',
          borderBottom: '1px solid rgba(255,255,255,0.1)',
          flexWrap: 'wrap',
          zIndex: 20,
        }}
      >
        {/* Tool buttons */}
        <div style={{ display: 'flex', alignItems: 'center', gap: '4px', flexWrap: 'wrap' }}>
          {(
            [
              { id: 'select', label: '↖ Select (V)' },
              { id: 'hand', label: '✋ Pan (H)' },
              { id: 'marker', label: '🖊 Marker (P)' },
              { id: 'highlighter', label: '🖍 Highlight (M)' },
              { id: 'laser', label: '🔴 Laser (L)' },
              { id: 'arrow', label: '↗ Arrow (A)' },
              { id: 'rect', label: '▭ Box (R)' },
              { id: 'ellipse', label: '◯ Circle (O)' },
              { id: 'text', label: 'T Text (T)' },
              { id: 'eraser', label: '⌫ Eraser (E)' },
            ] as { id: ToolKind; label: string }[]
          ).map((t) => (
            <button
              key={t.id}
              type="button"
              onClick={() => {
                setTool(t.id);
                setCroppingId(null);
              }}
              style={{
                padding: '5px 9px',
                fontSize: '12px',
                fontWeight: 600,
                borderRadius: '6px',
                border:
                  tool === t.id
                    ? '1px solid #4dabf7'
                    : '1px solid rgba(255,255,255,0.12)',
                background: tool === t.id ? '#1971c2' : '#252936',
                color: '#fff',
                cursor: 'pointer',
              }}
            >
              {t.label}
            </button>
          ))}
        </div>

        {/* Color & Stroke Width controls */}
        <div style={{ display: 'flex', alignItems: 'center', gap: '8px', flexWrap: 'wrap' }}>
          <div style={{ display: 'flex', alignItems: 'center', gap: '4px' }}>
            {COLORS.map((c) => (
              <button
                key={c}
                type="button"
                title={`Color ${c}`}
                onClick={() => {
                  setColor(c);
                  if (selectedItem && selectedItem.kind === 'text') {
                    setItems((prev) =>
                      prev.map((it) => (it.id === selectedItem.id ? { ...it, color: c } : it))
                    );
                  }
                }}
                style={{
                  width: '20px',
                  height: '20px',
                  borderRadius: '50%',
                  background: c,
                  border:
                    color === c ? '2px solid #4dabf7' : '1px solid rgba(255,255,255,0.3)',
                  transform: color === c ? 'scale(1.18)' : 'scale(1)',
                  cursor: 'pointer',
                }}
              />
            ))}
            <input
              type="color"
              value={color}
              onChange={(e) => setColor(e.target.value)}
              title="Custom color"
              style={{
                width: '22px',
                height: '22px',
                padding: 0,
                border: 'none',
                background: 'transparent',
                cursor: 'pointer',
              }}
            />
          </div>

          <div style={{ display: 'flex', alignItems: 'center', gap: '3px' }}>
            {SIZES.map((s) => (
              <button
                key={s.label}
                type="button"
                onClick={() => setStrokeSize(s.value)}
                style={{
                  padding: '3px 7px',
                  fontSize: '11px',
                  borderRadius: '4px',
                  border: '1px solid rgba(255,255,255,0.14)',
                  background: strokeSize === s.value ? '#495057' : '#252936',
                  color: '#fff',
                  cursor: 'pointer',
                }}
              >
                {s.label}
              </button>
            ))}
          </div>
        </div>

        {/* Actions: Upload, Undo/Redo, Clear, Export, View Mode */}
        <div style={{ display: 'flex', alignItems: 'center', gap: '5px', flexWrap: 'wrap' }}>
          <input
            ref={fileInputRef}
            type="file"
            accept="image/*,video/*"
            multiple
            style={{ display: 'none' }}
            onChange={(e) => {
              const files = e.target.files;
              if (!files) return;
              Array.from(files).forEach((file, idx) => {
                const url = URL.createObjectURL(file);
                addMediaItem({
                  kind: file.type.startsWith('video/')
                    ? 'video'
                    : file.type === 'image/gif'
                    ? 'gif'
                    : 'image',
                  src: url,
                  title: file.name,
                });
                if (idx > 0) {
                  // slight offset handled in addMediaItem
                }
              });
              e.target.value = '';
            }}
          />
          <button
            type="button"
            onClick={() => fileInputRef.current?.click()}
            style={{
              padding: '5px 9px',
              fontSize: '12px',
              borderRadius: '6px',
              border: '1px solid rgba(255,255,255,0.15)',
              background: '#2b3040',
              color: '#fff',
              cursor: 'pointer',
            }}
            title="Upload local GIF, image, or video from your computer"
          >
            + Upload Media
          </button>

          <button
            type="button"
            onClick={handleUndo}
            disabled={history.length === 0}
            style={{
              padding: '5px 8px',
              fontSize: '12px',
              borderRadius: '6px',
              border: '1px solid rgba(255,255,255,0.12)',
              background: '#252936',
              color: history.length === 0 ? '#6c757d' : '#fff',
              cursor: history.length === 0 ? 'not-allowed' : 'pointer',
            }}
            title="Undo (Cmd+Z)"
          >
            ↶
          </button>
          <button
            type="button"
            onClick={handleRedo}
            disabled={redoStack.length === 0}
            style={{
              padding: '5px 8px',
              fontSize: '12px',
              borderRadius: '6px',
              border: '1px solid rgba(255,255,255,0.12)',
              background: '#252936',
              color: redoStack.length === 0 ? '#6c757d' : '#fff',
              cursor: redoStack.length === 0 ? 'not-allowed' : 'pointer',
            }}
            title="Redo (Cmd+Shift+Z)"
          >
            ↷
          </button>

          {strokes.length > 0 && (
            <button
              type="button"
              onClick={() => {
                pushHistory(items, strokes);
                setStrokes([]);
              }}
              style={{
                padding: '5px 8px',
                fontSize: '12px',
                borderRadius: '6px',
                border: '1px solid rgba(255,255,255,0.12)',
                background: '#252936',
                color: '#ffc107',
                cursor: 'pointer',
              }}
              title="Clear all marker & highlighter drawings"
            >
              Clear Ink
            </button>
          )}

          {(items.length > 0 || strokes.length > 0) && (
            <button
              type="button"
              onClick={() => {
                pushHistory(items, strokes);
                setItems([]);
                setStrokes([]);
                setSelectedId(null);
                setCroppingId(null);
              }}
              style={{
                padding: '5px 8px',
                fontSize: '12px',
                borderRadius: '6px',
                border: '1px solid rgba(255,107,107,0.35)',
                background: '#252936',
                color: '#ff6b6b',
                cursor: 'pointer',
              }}
              title="Clear entire board"
            >
              Clear All
            </button>
          )}

          <button
            type="button"
            onClick={handleCopyShareLink}
            style={{
              padding: '5px 9px',
              fontSize: '12px',
              borderRadius: '6px',
              border: '1px solid rgba(116,192,252,0.4)',
              background: '#183b56',
              color: '#fff',
              cursor: 'pointer',
            }}
            title="Copy shareable board URL (?board=...) so AI or teammates can open this exact arrangement"
          >
            🔗 Share Link
          </button>

          <button
            type="button"
            onClick={handleCopyAiSpec}
            style={{
              padding: '5px 9px',
              fontSize: '12px',
              borderRadius: '6px',
              border: '1px solid rgba(175,82,222,0.5)',
              background: '#3b1f54',
              color: '#fff',
              cursor: 'pointer',
            }}
            title="Copy AI-ready Board JSON (asset IDs, URLs, positions, crops, arrows, and notes) to clipboard"
          >
            📋 Copy AI Spec
          </button>

          <button
            type="button"
            onClick={handleShareWithAi}
            style={{
              padding: '5px 9px',
              fontSize: '12px',
              fontWeight: 700,
              borderRadius: '6px',
              border: '1px solid rgba(52,199,89,0.55)',
              background: '#214d30',
              color: '#fff',
              cursor: 'pointer',
            }}
            title="Export Board PNG + JSON together and copy AI Spec to clipboard"
          >
            🤖 Share with AI
          </button>

          <button
            type="button"
            onClick={handleExportPng}
            style={{
              padding: '5px 9px',
              fontSize: '12px',
              borderRadius: '6px',
              border: '1px solid rgba(255,255,255,0.18)',
              background: '#252936',
              color: '#fff',
              cursor: 'pointer',
            }}
            title="Export board snapshot as PNG only"
          >
            📷 PNG
          </button>

          <button
            type="button"
            onClick={handleToggleRecording}
            style={{
              padding: '5px 9px',
              fontSize: '12px',
              borderRadius: '6px',
              border: '1px solid rgba(255,59,48,0.5)',
              background: isRecording ? '#c92a2a' : '#252936',
              color: '#fff',
              cursor: 'pointer',
            }}
            title="Record animated WebM video of the board"
          >
            {isRecording ? '⏹ Stop Rec' : '⏺ Rec Video'}
          </button>

          <button
            type="button"
            onClick={() => onChangeSplitMode(splitMode === 'board' ? 'split' : 'board')}
            style={{
              padding: '5px 9px',
              fontSize: '12px',
              borderRadius: '6px',
              border: '1px solid rgba(255,255,255,0.15)',
              background: '#252936',
              color: '#fff',
              cursor: 'pointer',
            }}
            title="Toggle full-screen board vs split-screen"
          >
            {splitMode === 'board' ? '◫ Split View' : '⛶ Full Board'}
          </button>
        </div>
      </div>

      {/* Toast Notification Banner */}
      {toastMessage && (
        <div
          style={{
            position: 'absolute',
            top: '58px',
            left: '50%',
            transform: 'translateX(-50%)',
            background: '#1971c2',
            color: '#fff',
            padding: '6px 14px',
            borderRadius: '20px',
            fontSize: '12px',
            fontWeight: 700,
            boxShadow: '0 6px 20px rgba(0,0,0,0.45)',
            zIndex: 50,
            pointerEvents: 'none',
          }}
        >
          {toastMessage}
        </div>
      )}

      {/* Contextual Floating Item Inspector when an item is selected */}
      {selectedItem && (
        <div
          style={{
            display: 'flex',
            alignItems: 'center',
            gap: '8px',
            padding: '6px 12px',
            background: '#222634',
            borderBottom: '1px solid rgba(255,255,255,0.08)',
            fontSize: '12px',
            flexWrap: 'wrap',
            zIndex: 19,
          }}
        >
          <span style={{ fontWeight: 700, color: '#74c0fc', maxWidth: '180px', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
            {selectedItem.title}
          </span>

          {selectedItem.kind !== 'text' && (
            <>
              {selectedItem.cutoutSrc && selectedItem.originalSrc && (
                <button
                  type="button"
                  onClick={() => {
                    pushHistory(items, strokes);
                    const nextIsCutout = selectedItem.src !== selectedItem.cutoutSrc;
                    setItems((prev) =>
                      prev.map((it) =>
                        it.id === selectedItem.id
                          ? {
                              ...it,
                              src: nextIsCutout
                                ? it.cutoutSrc || it.src
                                : it.originalSrc || it.src,
                            }
                          : it
                      )
                    );
                  }}
                  style={{
                    padding: '3px 8px',
                    borderRadius: '5px',
                    border:
                      selectedItem.src === selectedItem.cutoutSrc
                        ? '1px solid #20c997'
                        : '1px solid rgba(255,255,255,0.2)',
                    background:
                      selectedItem.src === selectedItem.cutoutSrc ? '#087f5b' : '#2c3244',
                    color: '#fff',
                    fontWeight: 600,
                    cursor: 'pointer',
                  }}
                  title="Toggle between transparent No-BG character cutout and Original image"
                >
                  {selectedItem.src === selectedItem.cutoutSrc
                    ? '✂️ No-BG ✓ (Show Orig)'
                    : '✂️ Remove BG'}
                </button>
              )}

              <button
                type="button"
                onClick={() =>
                  setCroppingId(croppingId === selectedItem.id ? null : selectedItem.id)
                }
                style={{
                  padding: '3px 8px',
                  borderRadius: '5px',
                  border: '1px solid rgba(255,255,255,0.2)',
                  background: croppingId === selectedItem.id ? '#e67700' : '#2c3244',
                  color: '#fff',
                  cursor: 'pointer',
                }}
              >
                {croppingId === selectedItem.id ? '✓ Done Cropping' : '✂ Crop'}
              </button>

              {(selectedItem.cropX > 0 ||
                selectedItem.cropY > 0 ||
                selectedItem.cropW < 1 ||
                selectedItem.cropH < 1) && (
                <button
                  type="button"
                  onClick={() => resetCrop(selectedItem.id)}
                  style={{
                    padding: '3px 8px',
                    borderRadius: '5px',
                    border: '1px solid rgba(255,255,255,0.2)',
                    background: '#2c3244',
                    color: '#ffd43b',
                    cursor: 'pointer',
                  }}
                >
                  Reset Crop
                </button>
              )}

              <button
                type="button"
                onClick={() =>
                  setItems((prev) =>
                    prev.map((it) =>
                      it.id === selectedItem.id ? { ...it, flipX: !it.flipX } : it
                    )
                  )
                }
                style={{
                  padding: '3px 8px',
                  borderRadius: '5px',
                  border: '1px solid rgba(255,255,255,0.2)',
                  background: '#2c3244',
                  color: '#fff',
                  cursor: 'pointer',
                }}
              >
                ⇄ Flip
              </button>
            </>
          )}

          <button
            type="button"
            onClick={() => changeLayer(selectedItem.id, 'front')}
            style={{
              padding: '3px 8px',
              borderRadius: '5px',
              border: '1px solid rgba(255,255,255,0.2)',
              background: '#2c3244',
              color: '#fff',
              cursor: 'pointer',
            }}
            title="Bring to Front"
          >
            ⬆ Front
          </button>
          <button
            type="button"
            onClick={() => changeLayer(selectedItem.id, 'forward')}
            style={{
              padding: '3px 8px',
              borderRadius: '5px',
              border: '1px solid rgba(255,255,255,0.2)',
              background: '#2c3244',
              color: '#fff',
              cursor: 'pointer',
            }}
            title="Bring Forward"
          >
            ↑ Up
          </button>
          <button
            type="button"
            onClick={() => changeLayer(selectedItem.id, 'backward')}
            style={{
              padding: '3px 8px',
              borderRadius: '5px',
              border: '1px solid rgba(255,255,255,0.2)',
              background: '#2c3244',
              color: '#fff',
              cursor: 'pointer',
            }}
            title="Send Backward"
          >
            ↓ Down
          </button>
          <button
            type="button"
            onClick={() => changeLayer(selectedItem.id, 'back')}
            style={{
              padding: '3px 8px',
              borderRadius: '5px',
              border: '1px solid rgba(255,255,255,0.2)',
              background: '#2c3244',
              color: '#fff',
              cursor: 'pointer',
            }}
            title="Send to Back"
          >
            ⬇ Back
          </button>

          <label style={{ display: 'flex', alignItems: 'center', gap: '4px' }}>
            Opacity
            <input
              type="range"
              min={0.15}
              max={1}
              step={0.05}
              value={selectedItem.opacity}
              onChange={(e) => {
                const val = parseFloat(e.target.value);
                setItems((prev) =>
                  prev.map((it) => (it.id === selectedItem.id ? { ...it, opacity: val } : it))
                );
              }}
              style={{ width: '70px' }}
            />
          </label>

          <button
            type="button"
            onClick={() => {
              setItems((prev) => {
                pushHistory(prev, strokes);
                const maxZ = prev.reduce((m, it) => Math.max(m, it.zIndex), 0);
                const copy: BoardMediaItem = {
                  ...selectedItem,
                  id: uid(),
                  x: selectedItem.x + 28,
                  y: selectedItem.y + 28,
                  zIndex: maxZ + 1,
                };
                setSelectedId(copy.id);
                return [...prev, copy];
              });
            }}
            style={{
              padding: '3px 8px',
              borderRadius: '5px',
              border: '1px solid rgba(255,255,255,0.2)',
              background: '#2c3244',
              color: '#fff',
              cursor: 'pointer',
            }}
          >
            ⧉ Duplicate
          </button>

          <button
            type="button"
            onClick={() =>
              setItems((prev) =>
                prev.map((it) =>
                  it.id === selectedItem.id ? { ...it, locked: !it.locked } : it
                )
              )
            }
            style={{
              padding: '3px 8px',
              borderRadius: '5px',
              border: '1px solid rgba(255,255,255,0.2)',
              background: selectedItem.locked ? '#495057' : '#2c3244',
              color: '#fff',
              cursor: 'pointer',
            }}
          >
            {selectedItem.locked ? '🔒 Locked' : '🔓 Lock'}
          </button>

          <button
            type="button"
            onClick={() => {
              setItems((prev) => {
                pushHistory(prev, strokes);
                return prev.filter((it) => it.id !== selectedItem.id);
              });
              setSelectedId(null);
              setCroppingId(null);
            }}
            style={{
              padding: '3px 8px',
              borderRadius: '5px',
              border: '1px solid rgba(255,107,107,0.4)',
              background: '#3b1f24',
              color: '#ff8787',
              cursor: 'pointer',
            }}
          >
            🗑 Delete
          </button>
        </div>
      )}

      {/* Main Interactive Infinite Canvas */}
      <div
        ref={viewportRef}
        data-board-bg="true"
        onPointerDown={handleBoardPointerDown}
        onPointerMove={handlePointerMove}
        onPointerUp={handlePointerUp}
        onPointerCancel={handlePointerUp}
        onWheel={handleWheel}
        onDragOver={handleDragOver}
        onDragLeave={handleDragLeave}
        onDrop={handleDrop}
        style={{
          ...bgStyle,
          flex: 1,
          position: 'relative',
          overflow: 'hidden',
          touchAction: 'none',
          cursor:
            spacePressed || tool === 'hand'
              ? 'grab'
              : tool === 'select'
              ? 'default'
              : 'crosshair',
          outline: isDragOver ? '3px dashed #4dabf7' : 'none',
          outlineOffset: '-6px',
        }}
      >
        {/* Empty state hint */}
        {items.length === 0 && strokes.length === 0 && (
          <div
            data-board-bg="true"
            style={{
              position: 'absolute',
              inset: 0,
              display: 'flex',
              flexDirection: 'column',
              alignItems: 'center',
              justifyContent: 'center',
              pointerEvents: 'none',
              color: bgTheme.startsWith('dark') ? 'rgba(255,255,255,0.45)' : 'rgba(0,0,0,0.45)',
              textAlign: 'center',
              padding: '24px',
            }}
          >
            <div style={{ fontSize: '42px', marginBottom: '10px' }}>🎨</div>
            <h4 style={{ fontWeight: 700, marginBottom: '6px' }}>Freeform GIF & Media Board</h4>
            <p style={{ maxWidth: '420px', fontSize: '13px', margin: 0 }}>
              Drag & drop GIFs or clips from the left library (or click <strong>+ Board</strong> on any card), drop images from your computer, stack & crop items, and use the Marker, Highlighter, Arrow, or Laser tools above!
            </p>
          </div>
        )}

        {/* Under-GIFs SVG Annotations Layer (full viewport dimensions) */}
        {!drawingsOnTop && renderSvgAnnotations(1)}

        {/* World Transform Plane */}
        <div
          data-board-bg="true"
          style={{
            position: 'absolute',
            left: 0,
            top: 0,
            width: 0,
            height: 0,
            zIndex: 5,
            transform: `translate(${pan.x}px, ${pan.y}px) scale(${zoom})`,
            transformOrigin: '0 0',
          }}
        >
          {sortedItems.map((item) => {
            const isSelected = item.id === selectedId;
            const isCropping = item.id === croppingId;
            const fullW = item.width / Math.max(0.05, item.cropW);
            const fullH = item.height / Math.max(0.05, item.cropH);
            const offsetX = -item.cropX * fullW;
            const offsetY = -item.cropY * fullH;

            return (
              <div
                key={item.id}
                onPointerDown={(e) => handleItemPointerDown(e, item)}
                onDoubleClick={(e) => {
                  e.stopPropagation();
                  if (item.kind === 'text') {
                    setEditingTextId(item.id);
                  } else {
                    setCroppingId(isCropping ? null : item.id);
                  }
                }}
                style={{
                  position: 'absolute',
                  left: `${item.x}px`,
                  top: `${item.y}px`,
                  width: `${item.width}px`,
                  height: `${item.height}px`,
                  transform: `rotate(${item.rotation}deg)`,
                  transformOrigin: 'center center',
                  zIndex: item.zIndex,
                  opacity: item.opacity,
                  pointerEvents: tool === 'select' && !spacePressed ? 'auto' : 'none',
                  cursor:
                    tool !== 'select'
                      ? 'crosshair'
                      : item.locked
                      ? 'not-allowed'
                      : 'move',
                  boxShadow: isSelected
                    ? isCropping
                      ? '0 0 0 2px #f59f00, 0 8px 24px rgba(0,0,0,0.45)'
                      : '0 0 0 2px #339af0, 0 8px 24px rgba(0,0,0,0.35)'
                    : '0 4px 14px rgba(0,0,0,0.25)',
                  borderRadius: '4px',
                }}
              >
                {/* Ghost uncropped preview when in crop mode */}
                {isCropping && item.kind !== 'text' && (
                  <div
                    style={{
                      position: 'absolute',
                      left: `${offsetX}px`,
                      top: `${offsetY}px`,
                      width: `${fullW}px`,
                      height: `${fullH}px`,
                      opacity: 0.28,
                      pointerEvents: 'none',
                      outline: '1px dashed #fcc419',
                    }}
                  >
                    {item.kind === 'video' ? (
                      <video
                        src={item.src}
                        muted
                        loop
                        playsInline
                        autoPlay
                        style={{
                          width: '100%',
                          height: '100%',
                          objectFit: 'fill',
                          transform: item.flipX ? 'scaleX(-1)' : undefined,
                        }}
                      />
                    ) : (
                      // eslint-disable-next-line @next/next/no-img-element
                      <img
                        src={item.src}
                        alt={item.title}
                        draggable={false}
                        style={{
                          width: '100%',
                          height: '100%',
                          objectFit: 'fill',
                          transform: item.flipX ? 'scaleX(-1)' : undefined,
                        }}
                      />
                    )}
                  </div>
                )}

                {/* Cropped Media Viewport */}
                <div
                  style={{
                    width: '100%',
                    height: '100%',
                    overflow: 'hidden',
                    position: 'relative',
                    borderRadius: '3px',
                  }}
                >
                  {item.kind === 'text' ? (
                    editingTextId === item.id ? (
                      <textarea
                        autoFocus
                        value={item.text || ''}
                        onChange={(e) => {
                          const val = e.target.value;
                          setItems((prev) =>
                            prev.map((it) => (it.id === item.id ? { ...it, text: val } : it))
                          );
                        }}
                        onBlur={() => setEditingTextId(null)}
                        style={{
                          width: '100%',
                          height: '100%',
                          background: item.bgColor || 'rgba(17,19,26,0.9)',
                          color: item.color || '#ffffff',
                          border: 'none',
                          outline: 'none',
                          padding: '10px 12px',
                          fontSize: `${item.fontSize || 20}px`,
                          fontWeight: 700,
                          fontFamily: 'inherit',
                          resize: 'none',
                        }}
                      />
                    ) : (
                      <div
                        style={{
                          width: '100%',
                          height: '100%',
                          background: item.bgColor || 'rgba(17,19,26,0.85)',
                          color: item.color || '#ffffff',
                          padding: '10px 12px',
                          fontSize: `${item.fontSize || 20}px`,
                          fontWeight: 700,
                          display: 'flex',
                          alignItems: 'center',
                          whiteSpace: 'pre-wrap',
                          wordBreak: 'break-word',
                        }}
                      >
                        {item.text || 'Double-click to edit'}
                      </div>
                    )
                  ) : item.kind === 'video' ? (
                    <video
                      ref={(el) => {
                        if (el) mediaElementsRef.current.set(item.id, el);
                        else mediaElementsRef.current.delete(item.id);
                      }}
                      src={item.src}
                      crossOrigin="anonymous"
                      muted
                      loop
                      playsInline
                      autoPlay
                      style={{
                        position: 'absolute',
                        left: `${offsetX}px`,
                        top: `${offsetY}px`,
                        width: `${fullW}px`,
                        height: `${fullH}px`,
                        objectFit: 'fill',
                        pointerEvents: 'none',
                        transform: item.flipX ? 'scaleX(-1)' : undefined,
                      }}
                    />
                  ) : (
                    // eslint-disable-next-line @next/next/no-img-element
                    <img
                      ref={(el) => {
                        if (el) mediaElementsRef.current.set(item.id, el);
                        else mediaElementsRef.current.delete(item.id);
                      }}
                      src={item.src}
                      alt={item.title}
                      crossOrigin="anonymous"
                      draggable={false}
                      style={{
                        position: 'absolute',
                        left: `${offsetX}px`,
                        top: `${offsetY}px`,
                        width: `${fullW}px`,
                        height: `${fullH}px`,
                        objectFit: 'fill',
                        pointerEvents: 'none',
                        transform: item.flipX ? 'scaleX(-1)' : undefined,
                      }}
                    />
                  )}
                </div>

                {/* Resize / Rotate / Crop Handles when selected in Select tool */}
                {isSelected && tool === 'select' && !item.locked && (
                  <>
                    {/* Rotation Handle */}
                    {!isCropping && (
                      <div
                        onPointerDown={(e) =>
                          handleTransformPointerDown(e, item, 'rotate-item', 'rotate')
                        }
                        title="Drag to rotate (hold Shift to snap 15°)"
                        style={{
                          position: 'absolute',
                          top: '-28px',
                          left: '50%',
                          transform: 'translateX(-50%)',
                          width: '18px',
                          height: '18px',
                          borderRadius: '50%',
                          background: '#339af0',
                          border: '2px solid #fff',
                          cursor: 'grab',
                          display: 'flex',
                          alignItems: 'center',
                          justifyContent: 'center',
                          fontSize: '10px',
                          color: '#fff',
                        }}
                      >
                        ↻
                      </div>
                    )}

                    {/* 8 Corner & Edge Handles */}
                    {(
                      [
                        { h: 'nw', left: '-6px', top: '-6px', cursor: 'nwse-resize' },
                        { h: 'n', left: 'calc(50% - 6px)', top: '-6px', cursor: 'ns-resize' },
                        { h: 'ne', right: '-6px', top: '-6px', cursor: 'nesw-resize' },
                        { h: 'e', right: '-6px', top: 'calc(50% - 6px)', cursor: 'ew-resize' },
                        { h: 'se', right: '-6px', bottom: '-6px', cursor: 'nwse-resize' },
                        { h: 's', left: 'calc(50% - 6px)', bottom: '-6px', cursor: 'ns-resize' },
                        { h: 'sw', left: '-6px', bottom: '-6px', cursor: 'nesw-resize' },
                        { h: 'w', left: '-6px', top: 'calc(50% - 6px)', cursor: 'ew-resize' },
                      ] as {
                        h: string;
                        left?: string;
                        right?: string;
                        top?: string;
                        bottom?: string;
                        cursor: string;
                      }[]
                    ).map((pos) => (
                      <div
                        key={pos.h}
                        onPointerDown={(e) =>
                          handleTransformPointerDown(
                            e,
                            item,
                            isCropping ? 'crop-item' : 'resize-item',
                            pos.h
                          )
                        }
                        style={{
                          position: 'absolute',
                          left: pos.left,
                          right: pos.right,
                          top: pos.top,
                          bottom: pos.bottom,
                          width: '12px',
                          height: '12px',
                          borderRadius: isCropping ? '2px' : '50%',
                          background: isCropping ? '#f59f00' : '#339af0',
                          border: '2px solid #ffffff',
                          cursor: pos.cursor,
                          zIndex: 10,
                        }}
                      />
                    ))}
                  </>
                )}
              </div>
            );
          })}
        </div>

        {/* Over-GIFs SVG Annotations Layer (full viewport dimensions) */}
        {drawingsOnTop && renderSvgAnnotations(15)}

        {/* Bottom-Right Board Controls: Zoom, Background Theme, Layer Toggle */}
        <div
          style={{
            position: 'absolute',
            right: '14px',
            bottom: '14px',
            display: 'flex',
            alignItems: 'center',
            gap: '6px',
            padding: '6px 10px',
            borderRadius: '8px',
            background: 'rgba(28, 31, 40, 0.92)',
            border: '1px solid rgba(255,255,255,0.12)',
            fontSize: '12px',
            zIndex: 20,
          }}
        >
          <button
            type="button"
            onClick={() => setZoom((z) => Math.max(0.25, +(z - 0.15).toFixed(2)))}
            style={{
              background: '#2c3244',
              color: '#fff',
              border: 'none',
              borderRadius: '4px',
              padding: '2px 7px',
              cursor: 'pointer',
            }}
          >
            −
          </button>
          <span
            onClick={() => {
              setZoom(1);
              setPan({ x: 0, y: 0 });
            }}
            title="Click to reset zoom & pan"
            style={{ minWidth: '44px', textAlign: 'center', cursor: 'pointer', fontWeight: 600 }}
          >
            {Math.round(zoom * 100)}%
          </span>
          <button
            type="button"
            onClick={() => setZoom((z) => Math.min(3, +(z + 0.15).toFixed(2)))}
            style={{
              background: '#2c3244',
              color: '#fff',
              border: 'none',
              borderRadius: '4px',
              padding: '2px 7px',
              cursor: 'pointer',
            }}
          >
            +
          </button>

          <select
            value={bgTheme}
            onChange={(e) => setBgTheme(e.target.value as BgTheme)}
            style={{
              background: '#2c3244',
              color: '#fff',
              border: '1px solid rgba(255,255,255,0.15)',
              borderRadius: '4px',
              padding: '2px 6px',
              fontSize: '11px',
              cursor: 'pointer',
            }}
            title="Canvas background theme"
          >
            <option value="dark-grid">Dark Grid</option>
            <option value="light-grid">Light Grid</option>
            <option value="dark-solid">Dark Solid</option>
            <option value="light-solid">Light Solid</option>
          </select>

          <button
            type="button"
            onClick={() => setDrawingsOnTop((v) => !v)}
            style={{
              background: '#2c3244',
              color: '#fff',
              border: '1px solid rgba(255,255,255,0.15)',
              borderRadius: '4px',
              padding: '2px 7px',
              fontSize: '11px',
              cursor: 'pointer',
            }}
            title="Toggle whether Marker/Highlighter strokes appear over or under GIFs"
          >
            {drawingsOnTop ? 'Ink: Over GIFs' : 'Ink: Under GIFs'}
          </button>
        </div>
      </div>
    </div>
  );
}
