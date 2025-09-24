import React, { useState, useRef, useEffect } from 'react';
import type { Point, Selection } from '../types';
import { UploadIcon, TrashIcon, CloseIcon, UndoIcon, RedoIcon, GoogleDriveIcon } from './Icons';

interface ImageSelectorProps {
  onImageUpload: (file: File) => void;
  onOpenFromDrive: () => void;
  imageSrc: string | null;
  fileName: string;
  selections: Selection[];
  onSelectionsChange: (selections: Selection[] | ((prev: Selection[]) => Selection[])) => void;
  onReset: () => void;
  onImageDimensionsChange: (dims: { naturalWidth: number; naturalHeight: number; }) => void;
  onUndo: () => void;
  onRedo: () => void;
  canUndo: boolean;
  canRedo: boolean;
  isSignedIn: boolean;
  gapiReady: boolean;
  isGoogleConfigured: boolean;
}

type DragAction =
  | 'draw'
  | 'move'
  | 'n-resize'
  | 'e-resize'
  | 's-resize'
  | 'w-resize'
  | null;

const LOUPE_SIZE = 150;
const LOUPE_RADIUS = LOUPE_SIZE / 2;
const LOUPE_ZOOM_LEVEL = 2.5;
const LOUPE_BORDER_WIDTH = 2; // The width of the loupe's border in pixels

const ImageSelector: React.FC<ImageSelectorProps> = ({
  onImageUpload,
  onOpenFromDrive,
  imageSrc,
  fileName,
  selections,
  onSelectionsChange,
  onReset,
  onImageDimensionsChange,
  onUndo,
  onRedo,
  canUndo,
  canRedo,
  isSignedIn,
  gapiReady,
  isGoogleConfigured,
}) => {
  const [internalSelections, setInternalSelections] = useState<Selection[]>(selections);
  const [dragAction, setDragAction] = useState<DragAction>(null);
  const [dragStartPoint, setDragStartPoint] = useState<Point | null>(null);
  const [activeSelectionId, setActiveSelectionId] = useState<string | null>(null);
  const [initialSelection, setInitialSelection] = useState<Selection | null>(null);
  
  const [loupeVisible, setLoupeVisible] = useState(false);
  const [loupePosition, setLoupePosition] = useState({ x: 0, y: 0 });
  const [loupeBgPosition, setLoupeBgPosition] = useState({ x: 0, y: 0 });

  const imageContainerRef = useRef<HTMLDivElement>(null);
  const fileInputRef = useRef<HTMLInputElement>(null);
  const imageRef = useRef<HTMLImageElement>(null);
  
  useEffect(() => {
    setInternalSelections(selections);
  }, [selections]);

  const getRelativeCoords = (e: { clientX: number, clientY: number }): Point => {
    if (!imageRef.current) return { x: 0, y: 0 };
    const rect = imageRef.current.getBoundingClientRect();
    const scaleX = imageRef.current.naturalWidth / rect.width;
    const scaleY = imageRef.current.naturalHeight / rect.height;

    // Clamp client coordinates to the image's bounding box
    const clientX = Math.max(rect.left, Math.min(e.clientX, rect.right));
    const clientY = Math.max(rect.top, Math.min(e.clientY, rect.bottom));
    
    const x = (clientX - rect.left) * scaleX;
    const y = (clientY - rect.top) * scaleY;

    return { x, y };
  };

  const findSelectionAtPoint = (point: Point): Selection | null => {
    // Iterate in reverse to select the top-most element
    for (let i = internalSelections.length - 1; i >= 0; i--) {
      const selection = internalSelections[i];
      const minX = Math.min(selection.start.x, selection.end.x);
      const maxX = Math.max(selection.start.x, selection.end.x);
      const minY = Math.min(selection.start.y, selection.end.y);
      const maxY = Math.max(selection.start.y, selection.end.y);
      if (point.x >= minX && point.x <= maxX && point.y >= minY && point.y <= maxY) {
        return selection;
      }
    }
    return null;
  };

  const performDrag = (currentPoint: Point) => {
    if (!dragAction || !dragStartPoint || !imageRef.current) return;

    const { naturalWidth: imageWidth, naturalHeight: imageHeight } = imageRef.current;
    
    const clampX = (x: number) => Math.max(0, Math.min(x, imageWidth));
    const clampY = (y: number) => Math.max(0, Math.min(y, imageHeight));

    setInternalSelections((prevSelections) => {
        let newSelections = [...prevSelections];
        const activeSelectionIndex = newSelections.findIndex(s => s.id === activeSelectionId);
        
        if (activeSelectionIndex === -1) return prevSelections;
    
        const activeSelection = newSelections[activeSelectionIndex];
    
        if (dragAction === 'draw') {
          newSelections[activeSelectionIndex] = {
            ...activeSelection,
            end: { x: clampX(currentPoint.x), y: clampY(currentPoint.y) },
          };
        } else if (initialSelection) {
          const dx = currentPoint.x - dragStartPoint.x;
          const dy = currentPoint.y - dragStartPoint.y;
    
          if (dragAction === 'move') {
            if (activeSelection.locked) return prevSelections;
            const { start: iStart, end: iEnd } = initialSelection;
            const width = Math.abs(iStart.x - iEnd.x);
            const height = Math.abs(iStart.y - iEnd.y);
            let minX = Math.min(iStart.x, iEnd.x) + dx;
            let minY = Math.min(iStart.y, iEnd.y) + dy;
            
            if (minX < 0) minX = 0;
            if (minY < 0) minY = 0;
            if (minX + width > imageWidth) minX = imageWidth - width;
            if (minY + height > imageHeight) minY = imageHeight - height;
            
            const deltaX = minX - Math.min(iStart.x, iEnd.x);
            const deltaY = minY - Math.min(iStart.y, iEnd.y);
            
            const newSelection = {
                ...initialSelection,
                start: { x: iStart.x + deltaX, y: iStart.y + deltaY },
                end: { x: iEnd.x + deltaX, y: iEnd.y + deltaY },
            };
            newSelections[activeSelectionIndex] = newSelection;
          } else { // Resizing
              if (activeSelection.locked) return prevSelections;

              const { start: iStart, end: iEnd } = initialSelection; // These are normalized
              let newStart = { ...iStart };
              let newEnd = { ...iEnd };
              const MIN_SIZE = 1;

              if (dragAction === 'n-resize') {
                  newStart.y = clampY(iStart.y + dy);
                  if (newStart.y > newEnd.y - MIN_SIZE) {
                      newStart.y = newEnd.y - MIN_SIZE;
                  }
              } else if (dragAction === 's-resize') {
                  newEnd.y = clampY(iEnd.y + dy);
                  if (newEnd.y < newStart.y + MIN_SIZE) {
                      newEnd.y = newStart.y + MIN_SIZE;
                  }
              } else if (dragAction === 'w-resize') {
                  newStart.x = clampX(iStart.x + dx);
                  if (newStart.x > newEnd.x - MIN_SIZE) {
                      newStart.x = newEnd.x - MIN_SIZE;
                  }
              } else if (dragAction === 'e-resize') {
                  newEnd.x = clampX(iEnd.x + dx);
                  if (newEnd.x < newStart.x + MIN_SIZE) {
                      newEnd.x = newStart.x + MIN_SIZE;
                  }
              }
    
              const newSelection = {
                  ...initialSelection,
                  start: newStart,
                  end: newEnd,
              };
              newSelections[activeSelectionIndex] = newSelection;
          }
        } 
        return newSelections;
    });
  }

  const handlePointerDown = (e: React.MouseEvent | React.TouchEvent) => {
    if (!imageSrc || !imageRef.current) return;
    
    const isTouchEvent = 'touches' in e;
    if (isTouchEvent && (e as React.TouchEvent).touches.length > 1) {
      return;
    }
    const touch = isTouchEvent ? (e as React.TouchEvent).touches[0] : null;
    const eventClient = isTouchEvent && touch ? touch : (e as React.MouseEvent);

    if(!eventClient) return;

    // Prevent drawing if clicking on an existing selection's move/resize handles
    const target = e.target as HTMLElement;
    if (target.closest('[data-handle="true"]')) {
      return;
    }

    const point = getRelativeCoords(eventClient);
    const clickedSelection = findSelectionAtPoint(point);

    if (clickedSelection) {
      return; // Handled by selection-specific handlers
    }
    
    const newSelection: Selection = {
      id: Date.now().toString(),
      start: point,
      end: point,
      locked: false,
    };

    setInternalSelections([...internalSelections, newSelection]);
    setDragAction('draw');
    setDragStartPoint(point);
    setActiveSelectionId(newSelection.id);
    setInitialSelection(newSelection);
    setLoupeVisible(true);
  };

  const handleSelectionMouseDown = (e: React.MouseEvent, selection: Selection) => {
    e.stopPropagation();
    if (selection.locked) return;
    setActiveSelectionId(selection.id);
    setDragAction('move');
    setDragStartPoint(getRelativeCoords(e));
    setInitialSelection(selection);
  };

  const handleSelectionTouchStart = (e: React.TouchEvent, selection: Selection) => {
    e.stopPropagation();
    if (selection.locked || e.touches.length > 1) return;
    if (!e.touches[0]) return;
    setActiveSelectionId(selection.id);
    setDragAction('move');
    setDragStartPoint(getRelativeCoords(e.touches[0]));
    setInitialSelection(selection);
  };

  const handleResizeHandleDown = (e: React.MouseEvent | React.TouchEvent, action: DragAction, selection: Selection) => {
    e.stopPropagation();

    const isTouchEvent = 'touches' in e;
     if (isTouchEvent && (e as React.TouchEvent).touches.length > 1) {
      return;
    }
    const touch = isTouchEvent ? (e as React.TouchEvent).touches[0] : null;
    const eventClient = isTouchEvent && touch ? touch : (e as React.MouseEvent);

    if(!eventClient || selection.locked) return;
    
    setActiveSelectionId(selection.id);
    setDragAction(action);
    setDragStartPoint(getRelativeCoords(eventClient));
    
    const normalizedSelection = {
        ...selection,
        start: {
            x: Math.min(selection.start.x, selection.end.x),
            y: Math.min(selection.start.y, selection.end.y),
        },
        end: {
            x: Math.max(selection.start.x, selection.end.x),
            y: Math.max(selection.start.y, selection.end.y),
        },
    };
    setInitialSelection(normalizedSelection);
    setLoupeVisible(true);
  };
  
  const handleDragEnd = () => {
      if (dragAction) {
        const finalSelections = internalSelections.filter(s => {
          const width = Math.abs(s.start.x - s.end.x);
          const height = Math.abs(s.start.y - s.end.y);
          return width > 1 && height > 1;
        });
        onSelectionsChange(finalSelections);

        setDragAction(null);
        setDragStartPoint(null);
        setInitialSelection(null);
        setLoupeVisible(false);
      }
  };

  const updateLoupePosition = (clientPoint: { clientX: number, clientY: number }, relativePoint: Point) => {
    if (!loupeVisible || !imageRef.current || !dragAction || dragAction === 'move') return;

    let yOffset = LOUPE_SIZE + 20;
    if ('ontouchstart' in window) {
      if (clientPoint.clientY - yOffset < 0) {
        yOffset = -LOUPE_SIZE - 20;
      }
    }

    setLoupePosition({
        x: clientPoint.clientX - LOUPE_RADIUS,
        y: clientPoint.clientY - yOffset, 
    });
    
    const bgX = (LOUPE_RADIUS - LOUPE_BORDER_WIDTH) - (relativePoint.x * LOUPE_ZOOM_LEVEL);
    const bgY = (LOUPE_RADIUS - LOUPE_BORDER_WIDTH) - (relativePoint.y * LOUPE_ZOOM_LEVEL);
    
    setLoupeBgPosition({ x: bgX, y: bgY });
  }

  const handleMouseMove = (e: MouseEvent) => {
    const relativePoint = getRelativeCoords(e);
    updateLoupePosition(e, relativePoint);
    if (dragAction) {
      performDrag(relativePoint);
    }
  };

  const handleTouchMove = (e: TouchEvent) => {
    if (dragAction && e.touches.length === 1 && e.touches[0]) {
        const touch = e.touches[0];
        const relativePoint = getRelativeCoords(touch);
        updateLoupePosition(touch, relativePoint);
        if (e.cancelable) e.preventDefault();
        performDrag(relativePoint);
    }
  };

  useEffect(() => {
    const options: AddEventListenerOptions = { passive: false };
    window.addEventListener('mousemove', handleMouseMove);
    window.addEventListener('mouseup', handleDragEnd);
    window.addEventListener('touchmove', handleTouchMove, options);
    window.addEventListener('touchend', handleDragEnd);
    
    return () => {
        window.removeEventListener('mousemove', handleMouseMove);
        window.removeEventListener('mouseup', handleDragEnd);
        window.removeEventListener('touchmove', handleTouchMove, options);
        window.removeEventListener('touchend', handleDragEnd);
    };
  }, [dragAction, internalSelections]);


  useEffect(() => {
    if (!imageSrc) {
      onSelectionsChange([]);
      setActiveSelectionId(null);
    }
  }, [imageSrc, onSelectionsChange]);

  const handleFileChange = (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (file) {
      onImageUpload(file);
    }
    e.target.value = '';
  };

  const handleDrop = (e: React.DragEvent<HTMLDivElement>) => {
    e.preventDefault();
    e.stopPropagation();
    const file = e.dataTransfer.files?.[0];
    if (file && file.type.startsWith('image/')) {
      onImageUpload(file);
    }
  };

  const handleDragOver = (e: React.DragEvent<HTMLDivElement>) => {
    e.preventDefault();
    e.stopPropagation();
  };
  
  const handleImageLoad = (e: React.SyntheticEvent<HTMLImageElement>) => {
    const img = e.currentTarget;
    onImageDimensionsChange({
        naturalWidth: img.naturalWidth,
        naturalHeight: img.naturalHeight,
    });
  };
  
  const onClearAll = () => {
    onSelectionsChange([]);
    setActiveSelectionId(null);
  };

  const renderHandles = (selection: Selection) => {
    if (selection.locked) return null;
    const handleClasses = "absolute bg-white border border-gray-800 rounded-full w-3 h-3";
    const touchAreaClasses = "absolute w-8 h-8 flex items-center justify-center";
    
    const resizeHandles: { position: string; cursor: string; action: DragAction }[] = [
      { position: 'top-0 left-1/2 -translate-x-1/2 -translate-y-1/2', cursor: 'cursor-ns-resize', action: 'n-resize' },
      { position: 'top-1/2 right-0 -translate-y-1/2 translate-x-1/2', cursor: 'cursor-ew-resize', action: 'e-resize' },
      { position: 'bottom-0 left-1/2 -translate-x-1/2 translate-y-1/2', cursor: 'cursor-ns-resize', action: 's-resize' },
      { position: 'top-1/2 left-0 -translate-y-1/2 -translate-x-1/2', cursor: 'cursor-ew-resize', action: 'w-resize' },
    ];
    return resizeHandles.map(({position, cursor, action}) => (
        <div 
          key={action} 
          className={`${touchAreaClasses} ${position} ${cursor}`}
          onMouseDown={(e) => handleResizeHandleDown(e, action, selection)}
          onTouchStart={(e) => handleResizeHandleDown(e, action, selection)}
          data-handle="true"
        >
          <div className={handleClasses}></div>
        </div>
    ));
  };

  return (
    <div className="space-y-4 flex flex-col flex-grow">
       {loupeVisible && imageSrc && imageRef.current && dragAction !== 'move' && (
        <div
          className="fixed pointer-events-none rounded-full border-2 border-cyan-400 shadow-lg bg-no-repeat z-50"
          style={{
            left: loupePosition.x,
            top: loupePosition.y,
            width: LOUPE_SIZE,
            height: LOUPE_SIZE,
            backgroundImage: `url(${imageSrc})`,
            backgroundSize: `${imageRef.current.naturalWidth * LOUPE_ZOOM_LEVEL}px ${imageRef.current.naturalHeight * LOUPE_ZOOM_LEVEL}px`,
            backgroundPosition: `${loupeBgPosition.x}px ${loupeBgPosition.y}px`,
            transform: 'translateZ(0)',
          }}
          aria-hidden="true"
        >
          {/* Crosshair */}
          <div className="absolute top-1/2 left-0 w-full h-px bg-red-500 opacity-75 -translate-y-1/2"></div>
          <div className="absolute left-1/2 top-0 h-full w-px bg-red-500 opacity-75 -translate-x-1/2"></div>
        </div>
      )}

      <input
        type="file"
        ref={fileInputRef}
        onChange={handleFileChange}
        accept="image/*"
        className="hidden"
      />
      {!imageSrc ? (
        <div
          onDrop={handleDrop}
          onDragOver={handleDragOver}
          className="w-full flex-grow border-2 border-dashed border-gray-600 rounded-lg flex flex-col justify-center items-center text-gray-400 transition-colors p-4"
          aria-label="Image upload area"
        >
          <div className="text-center mb-4">
            <UploadIcon className="w-12 h-12 mb-2 mx-auto" />
            <p className="font-semibold">Upload from Computer</p>
            <p className="text-sm">Drag & drop or click below</p>
          </div>
          <button
              onClick={() => fileInputRef.current?.click()}
              className="px-4 py-2 bg-gray-700 hover:bg-gray-600 text-white font-semibold rounded-md transition-colors"
            >
              Select File
          </button>
          <div className="my-4 text-xs font-bold text-gray-500">OR</div>
          <button
              onClick={onOpenFromDrive}
              disabled={!isSignedIn || !gapiReady || !isGoogleConfigured}
              className="flex items-center justify-center px-4 py-2 bg-blue-600 hover:bg-blue-500 text-white font-semibold rounded-md transition-colors disabled:opacity-50 disabled:cursor-not-allowed"
            >
              <GoogleDriveIcon className="w-5 h-5 mr-2" />
              Open from Drive
          </button>
        </div>
      ) : (
        <div className="space-y-2 flex flex-col flex-grow">
          <div className="flex items-center justify-end bg-gray-800/50 p-2 rounded-md flex-wrap gap-2">
                <div className="flex items-center space-x-2">
                    <button onClick={onUndo} title="Undo" className="p-1.5 rounded-md hover:bg-gray-700 transition-colors disabled:opacity-50 disabled:cursor-not-allowed" disabled={!canUndo}><UndoIcon className="w-5 h-5"/></button>
                    <button onClick={onRedo} title="Redo" className="p-1.5 rounded-md hover:bg-gray-700 transition-colors disabled:opacity-50 disabled:cursor-not-allowed" disabled={!canRedo}><RedoIcon className="w-5 h-5"/></button>
                    {selections.length > 0 && (
                        <button onClick={onClearAll} title="Clear All Selections" className="flex items-center text-sm p-1.5 rounded-md text-red-400 hover:bg-red-900/50 transition-colors"><TrashIcon className="w-5 h-5 mr-1"/> Clear All</button>
                    )}
                </div>
          </div>
          <div
            ref={imageContainerRef}
            className="relative select-none rounded-lg border-2 border-gray-700 flex-grow bg-gray-900/50 cursor-crosshair touch-none flex justify-center items-center"
            onMouseDown={handlePointerDown}
            onTouchStart={handlePointerDown}
          >
            <div className="relative pointer-events-none">
                <img 
                    ref={imageRef}
                    src={imageSrc} 
                    alt="Upload" 
                    className="block pointer-events-auto max-w-full max-h-full"
                    onLoad={handleImageLoad}
                />
                {imageRef.current && internalSelections.map((selection) => {
                  const { naturalWidth, naturalHeight } = imageRef.current;
                  const { clientWidth, clientHeight } = imageRef.current;

                  const scaleX = clientWidth / naturalWidth;
                  const scaleY = clientHeight / naturalHeight;

                  const { start, end } = selection;
                  const left = Math.min(start.x, end.x) * scaleX;
                  const top = Math.min(start.y, end.y) * scaleY;
                  const width = Math.abs(start.x - end.x) * scaleX;
                  const height = Math.abs(start.y - end.y) * scaleY;
                  const isActive = selection.id === activeSelectionId;
                  
                  if (width === 0 && height === 0 && dragAction !== 'draw') return null;
                  
                  const borderStyle = selection.locked
                    ? 'border-red-500 bg-red-500/10'
                    : isActive
                    ? 'border-cyan-400 bg-cyan-400/20'
                    : 'border-dashed border-yellow-400 bg-yellow-400/10';

                  const cursorStyle = selection.locked ? 'cursor-default' : 'cursor-move';

                  return (
                    <div
                      key={selection.id}
                      className={`absolute border-2 ${borderStyle} ${cursorStyle} pointer-events-auto`}
                      style={{ left, top, width, height }}
                      onMouseDown={(e) => handleSelectionMouseDown(e, selection)}
                      onTouchStart={(e) => handleSelectionTouchStart(e, selection)}
                      aria-label={`Selection box ${selection.id}`}
                    >
                      {isActive && renderHandles(selection)}
                    </div>
                  );
                })}
            </div>
          </div>
          <div className="flex items-center justify-between bg-gray-700/50 p-2 rounded-md">
            <p className="text-sm text-gray-300 truncate pr-4">{fileName}</p>
            <button
              onClick={onReset}
              className="text-sm text-red-400 hover:text-red-300 font-semibold flex-shrink-0"
            >
              Remove Image
            </button>
          </div>
        </div>
      )}
    </div>
  );
};

export default ImageSelector;
