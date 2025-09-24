import React, { useState, useMemo, useEffect, useCallback } from 'react';
import { Selection } from './types';
import ImageSelector from './components/ImageSelector';
import { BoundingBoxIcon, ClipboardIcon, CheckIcon, DownloadIcon, LockIcon, UnlockIcon, TrashIcon, GoogleDriveIcon } from './components/Icons';

// FIX: Add type declarations for gapi and google to the window object.
declare global {
  interface Window {
    gapi: any;
    google: any;
  }
}

// --- IMPORTANT ---
// To use the Google Drive integration, you must configure your own Client ID and API Key.
// 1. Go to https://console.cloud.google.com/apis/credentials
// 2. Create an "OAuth 2.0 Client ID" of type "Web application".
//    - Add your app's origin (e.g., https://your-app-url.run.app) to "Authorized JavaScript origins".
//    - Add your app's origin to "Authorized redirect URIs".
// 3. Create an "API Key".
// 4. Enable the "Google Drive API" and "Google Picker API" for your project.
// 5. Set GOOGLE_CLIENT_ID and GOOGLE_API_KEY as environment variables in your deployment environment.
const GOOGLE_CLIENT_ID = process.env.GOOGLE_CLIENT_ID;
const GOOGLE_API_KEY = process.env.GOOGLE_API_KEY;
const SCOPES = 'https://www.googleapis.com/auth/drive.file https://www.googleapis.com/auth/drive.readonly';


interface ImageDimensions {
  naturalWidth: number;
  naturalHeight: number;
}

interface DriveFileMeta {
  id: string;
  name: string;
  parentId: string | null;
}

const App: React.FC = () => {
  const [imageSrc, setImageSrc] = useState<string | null>(null);
  const [selections, setSelections] = useState<Selection[]>([]);
  const [fileName, setFileName] = useState<string>('');
  const [imageDimensions, setImageDimensions] = useState<ImageDimensions | null>(null);
  const [isCopied, setIsCopied] = useState(false);
  
  const [history, setHistory] = useState<Selection[][]>([[]]);
  const [historyIndex, setHistoryIndex] = useState(0);

  // Google Drive State
  const [isGoogleConfigured, setIsGoogleConfigured] = useState(false);
  const [isSignedIn, setIsSignedIn] = useState(false);
  const [gapiReady, setGapiReady] = useState(false);
  const [gisReady, setGisReady] = useState(false);
  const [tokenClient, setTokenClient] = useState<any>(null);
  const [driveFileMeta, setDriveFileMeta] = useState<DriveFileMeta | null>(null);
  const [isSavingToDrive, setIsSavingToDrive] = useState(false);
  const [userProfile, setUserProfile] = useState<{name: string, picture: string} | null>(null);


  const canUndo = historyIndex > 0;
  const canRedo = historyIndex < history.length - 1;

  useEffect(() => {
    if (GOOGLE_CLIENT_ID && GOOGLE_API_KEY) {
      setIsGoogleConfigured(true);
    }
  }, []);

  // --- Google Drive Integration Hooks ---
  useEffect(() => {
    const handleGapiLoad = () => {
      window.gapi.load('client:picker', () => {
        setGapiReady(true);
      });
    };
    
    const handleGisLoad = () => {
      setGisReady(true);
    };

    const gapiScript = document.querySelector('script[src="https://apis.google.com/js/api.js"]');
    const gisScript = document.querySelector('script[src="https://accounts.google.com/gsi/client"]');

    if (window.gapi) {
      handleGapiLoad();
    } else {
      gapiScript?.addEventListener('load', handleGapiLoad);
    }

    if (window.google?.accounts) {
      handleGisLoad();
    } else {
      gisScript?.addEventListener('load', handleGisLoad);
    }
    
    return () => {
      gapiScript?.removeEventListener('load', handleGapiLoad);
      gisScript?.removeEventListener('load', handleGisLoad);
    };
  }, []);

  useEffect(() => {
    if (gisReady && isGoogleConfigured) {
      const client = window.google.accounts.oauth2.initTokenClient({
        client_id: GOOGLE_CLIENT_ID,
        scope: SCOPES,
        callback: async (tokenResponse: any) => {
          if (tokenResponse.access_token) {
            window.gapi.client.setToken({ access_token: tokenResponse.access_token });
            setIsSignedIn(true);
            const userInfo = await fetch('https://www.googleapis.com/oauth2/v3/userinfo', {
              headers: { Authorization: `Bearer ${tokenResponse.access_token}` }
            }).then(res => res.json());
            setUserProfile({name: userInfo.name, picture: userInfo.picture});
          }
        },
      });
      setTokenClient(client);
    }
  }, [gisReady, isGoogleConfigured]);

  // --- Auth & Picker Handlers ---
  const handleAuthClick = () => {
    if (tokenClient) {
      if (window.gapi.client.getToken() === null) {
        tokenClient.requestAccessToken({ prompt: 'consent' });
      } else {
        tokenClient.requestAccessToken({ prompt: '' });
      }
    }
  };

  const handleSignOutClick = () => {
    const token = window.gapi.client.getToken();
    if (token) {
      window.google.accounts.oauth2.revoke(token.access_token, () => {
        window.gapi.client.setToken(null);
        setIsSignedIn(false);
        setUserProfile(null);
        handleReset();
      });
    }
  };

  const createPicker = () => {
      if (!isGoogleConfigured) return;
      const view = new window.google.picker.View(window.google.picker.ViewId.DOCS);
      view.setMimeTypes("image/png,image/jpeg,image/jpg,image/webp");
      const picker = new window.google.picker.PickerBuilder()
          .setAppId(GOOGLE_CLIENT_ID.split('-')[0])
          .setOAuthToken(window.gapi.client.getToken().access_token)
          .addView(view)
          .setDeveloperKey(GOOGLE_API_KEY)
          .setCallback(pickerCallback)
          .build();
      picker.setVisible(true);
  };
  
  const pickerCallback = (data: any) => {
    if (data[window.google.picker.Response.ACTION] === window.google.picker.Action.PICKED) {
      const doc = data[window.google.picker.Response.DOCUMENTS][0];
      const fileId = doc.id;
      const token = window.gapi.client.getToken().access_token;
      
      // Fetch image content
      fetch(`https://www.googleapis.com/drive/v3/files/${fileId}?alt=media`, {
        headers: { 'Authorization': `Bearer ${token}` }
      })
      .then(res => res.blob())
      .then(blob => {
        const reader = new FileReader();
        reader.onload = e => {
            setImageSrc(e.target?.result as string);
            setFileName(doc.name);
            commitSelections([]);
        };
        reader.readAsDataURL(blob);
      });
      
      // Fetch metadata to get parent folder
      fetch(`https://www.googleapis.com/drive/v3/files/${fileId}?fields=id,name,parents`, {
          headers: { 'Authorization': `Bearer ${token}` }
      })
      .then(res => res.json())
      .then(meta => {
          setDriveFileMeta({
              id: meta.id,
              name: meta.name,
              parentId: meta.parents ? meta.parents[0] : null
          });
      });
    }
  };

  // --- Core App Logic ---
  const commitSelections = useCallback((newSelections: Selection[] | ((prev: Selection[]) => Selection[])) => {
    setSelections(prevSelections => {
        const nextSelections = typeof newSelections === 'function' ? newSelections(prevSelections) : newSelections;

        if (JSON.stringify(nextSelections) === JSON.stringify(prevSelections)) {
            return prevSelections;
        }

        const newHistory = history.slice(0, historyIndex + 1);
        newHistory.push(nextSelections);
        setHistory(newHistory);
        setHistoryIndex(newHistory.length - 1);
        return nextSelections;
    });
  }, [history, historyIndex]);

  useEffect(() => {
    if (JSON.stringify(history[historyIndex]) !== JSON.stringify(selections)) {
      setSelections(history[historyIndex]);
    }
  }, [history, historyIndex, selections]);

  const handleUndo = () => canUndo && setHistoryIndex(historyIndex - 1);
  const handleRedo = () => canRedo && setHistoryIndex(historyIndex + 1);

  const handleImageUpload = (file: File) => {
    const reader = new FileReader();
    reader.onload = (e) => {
      setImageSrc(e.target?.result as string);
      setFileName(file.name);
      setDriveFileMeta(null); // It's a local file
      commitSelections([]);
    };
    reader.readAsDataURL(file);
  };
  
  const handleReset = () => {
    setImageSrc(null);
    setFileName('');
    setSelections([]);
    setImageDimensions(null);
    setIsCopied(false);
    setDriveFileMeta(null);
    setHistory([[]]);
    setHistoryIndex(0);
  }
  
  const handleToggleLock = (id: string) => commitSelections(prev => prev.map(sel => sel.id === id ? { ...sel, locked: !sel.locked } : sel));
  const handleDeleteSelection = (id: string) => commitSelections(prev => prev.filter(sel => sel.id !== id));

  const selectionCoords = useMemo(() => selections.map(selection => ({
    id: selection.id,
    locked: !!selection.locked,
    x: Math.round(Math.min(selection.start.x, selection.end.x)),
    y: Math.round(Math.min(selection.start.y, selection.end.y)),
    width: Math.round(Math.abs(selection.start.x - selection.end.x)),
    height: Math.round(Math.abs(selection.start.y - selection.end.y)),
  })), [selections]);

  const yoloString = useMemo(() => {
    if (selectionCoords.length > 0 && imageDimensions) {
      return selectionCoords
        .filter(coords => coords.width > 0 && coords.height > 0)
        .map(coords => {
          const x_center = (coords.x + coords.width / 2) / imageDimensions.naturalWidth;
          const y_center = (coords.y + coords.height / 2) / imageDimensions.naturalHeight;
          const width = coords.width / imageDimensions.naturalWidth;
          const height = coords.height / imageDimensions.naturalHeight;
          
          return `0 ${x_center.toFixed(6)} ${y_center.toFixed(6)} ${width.toFixed(6)} ${height.toFixed(6)}`;
        })
        .join('\n');
    }
    return null;
  }, [selectionCoords, imageDimensions]);

  const handleCopy = () => {
    if (yoloString) {
      navigator.clipboard.writeText(yoloString);
      setIsCopied(true);
      setTimeout(() => setIsCopied(false), 2000);
    }
  };

  const handleSaveToFile = () => {
    if (driveFileMeta) {
      saveToDrive();
    } else {
      saveToLocal();
    }
  };
  
  const saveToLocal = () => {
    if (yoloString && fileName) {
      const blob = new Blob([yoloString], { type: 'text/plain;charset=utf-8' });
      const link = document.createElement('a');
      link.href = URL.createObjectURL(blob);
      
      const baseName = fileName.includes('.') ? fileName.split('.').slice(0, -1).join('.') : fileName;
      link.download = `${baseName}.txt`;

      document.body.appendChild(link);
      link.click();
      document.body.removeChild(link);
      URL.revokeObjectURL(link.href);
    }
  };

  const saveToDrive = () => {
    if (!yoloString || !driveFileMeta) return;

    setIsSavingToDrive(true);
    const baseName = driveFileMeta.name.includes('.') ? driveFileMeta.name.split('.').slice(0, -1).join('.') : driveFileMeta.name;
    const txtFileName = `${baseName}.txt`;
    const metadata = {
        name: txtFileName,
        mimeType: 'text/plain',
        ...(driveFileMeta.parentId && { parents: [driveFileMeta.parentId] })
    };
    const fileContent = new Blob([yoloString], { type: 'text/plain' });
    const form = new FormData();
    form.append('metadata', new Blob([JSON.stringify(metadata)], { type: 'application/json' }));
    form.append('file', fileContent);
    
    fetch('https://www.googleapis.com/upload/drive/v3/files?uploadType=multipart', {
        method: 'POST',
        headers: new Headers({ 'Authorization': `Bearer ${window.gapi.client.getToken().access_token}` }),
        body: form
    })
    .then(res => res.json())
    .then(data => {
        if(data.id){
            // Success! Could show a notification.
        } else {
            // Handle error
            console.error("Error saving to drive:", data);
        }
    })
    .catch(error => console.error("Error saving to drive:", error))
    .finally(() => setIsSavingToDrive(false));
  };
  
  return (
    <div className="min-h-screen bg-gray-900 text-gray-100 flex flex-col p-4 sm:p-6 md:p-8">
      <div className="w-full max-w-6xl mx-auto flex justify-between items-center mb-4">
        <div></div> {/* Spacer */}
        {!isGoogleConfigured ? (
           <div className="flex items-center space-x-2 text-sm text-yellow-400 p-2 bg-yellow-900/50 rounded-md" role="alert">
                <svg xmlns="http://www.w3.org/2000/svg" className="h-5 w-5" viewBox="0 0 20 20" fill="currentColor">
                    <path fillRule="evenodd" d="M8.257 3.099c.636-1.21 2.37-1.21 3.006 0l7.333 13.998c.605 1.154-.31 2.57-1.503 2.57H2.427c-1.193 0-2.108-1.416-1.503-2.57L8.257 3.099zM10 14a1 1 0 110-2 1 1 0 010 2zm-1-3a1 1 0 001 1h0a1 1 0 001-1V8a1 1 0 00-2 0v3z" clipRule="evenodd" />
                </svg>
                <span>Google Drive features are not configured.</span>
            </div>
        ) : isSignedIn && userProfile ? (
          <div className="flex items-center space-x-3">
            <img src={userProfile.picture} alt="User" className="w-8 h-8 rounded-full" />
            <span className="text-sm font-medium">{userProfile.name}</span>
            <button onClick={handleSignOutClick} className="text-sm text-cyan-400 hover:underline">Sign Out</button>
          </div>
        ) : (
          <button
            onClick={handleAuthClick}
            disabled={!gapiReady || !gisReady}
            className="flex items-center justify-center px-4 py-2 bg-blue-600 hover:bg-blue-500 text-white font-semibold rounded-md transition-colors disabled:opacity-50 disabled:cursor-not-allowed"
          >
            Sign in with Google
          </button>
        )}
      </div>

      <main className="w-full max-w-6xl mx-auto flex flex-col flex-grow space-y-8">
        <header className="text-center">
          <h1 className="text-4xl sm:text-5xl font-bold text-transparent bg-clip-text bg-gradient-to-r from-purple-400 to-cyan-400">
            Bounding Box Annotation Tool
          </h1>
          <p className="mt-2 text-gray-400">
            Upload an image, select objects, and get their YOLO coordinates.
          </p>
        </header>

        <div className="grid grid-cols-1 lg:grid-cols-2 gap-8 flex-grow min-h-0">
          <div className="w-full flex flex-col">
            <ImageSelector
              onImageUpload={handleImageUpload}
              onOpenFromDrive={createPicker}
              imageSrc={imageSrc}
              fileName={fileName}
              selections={selections}
              onSelectionsChange={commitSelections}
              onReset={handleReset}
              onImageDimensionsChange={setImageDimensions}
              onUndo={handleUndo}
              onRedo={handleRedo}
              canUndo={canUndo}
              canRedo={canRedo}
              isSignedIn={isSignedIn}
              gapiReady={gapiReady}
              isGoogleConfigured={isGoogleConfigured}
            />
          </div>

          <div className="w-full flex flex-col gap-6">
            <div className="bg-gray-800/50 rounded-lg p-6 border border-gray-700 flex-grow overflow-y-auto">
              <h2 className="text-xl font-semibold mb-4 flex items-center">
                <BoundingBoxIcon className="w-6 h-6 mr-2 text-cyan-400" />
                Selection Details
              </h2>
              {selectionCoords.length > 0 ? (
                <div className="space-y-4">
                  {selectionCoords.map((coords, index) => (
                    coords.width > 0 && coords.height > 0 && (
                      <div key={coords.id} className="text-gray-300 p-3 bg-gray-700/30 rounded-md">
                         <div className="flex justify-between items-center mb-2">
                           <p className="text-sm font-bold text-cyan-400">Box {index + 1}</p>
                           <div className="flex items-center space-x-3">
                                <button onClick={() => handleToggleLock(coords.id)} title={coords.locked ? 'Unlock' : 'Lock'}>
                                    {coords.locked ? <LockIcon className="w-4 h-4 text-yellow-400"/> : <UnlockIcon className="w-4 h-4 text-gray-400 hover:text-white"/> }
                                </button>
                                <button onClick={() => handleDeleteSelection(coords.id)} title="Delete">
                                    <TrashIcon className="w-4 h-4 text-gray-400 hover:text-red-400"/>
                                </button>
                           </div>
                         </div>
                         <div className="grid grid-cols-2 gap-x-4 gap-y-1">
                             <p className="text-sm"><span className="font-semibold text-gray-100">X:</span> {coords.x} px</p>
                             <p className="text-sm"><span className="font-semibold text-gray-100">Y:</span> {coords.y} px</p>
                             <p className="text-sm"><span className="font-semibold text-gray-100">Width:</span> {coords.width} px</p>
                             <p className="text-sm"><span className="font-semibold text-gray-100">Height:</span> {coords.height} px</p>
                         </div>
                      </div>
                    )
                  ))}
                </div>
              ) : (
                <p className="text-gray-500">Draw a box on the image to see selection details.</p>
              )}
            </div>

            <div className="bg-gray-800/50 rounded-lg p-6 border border-gray-700">
              <h2 className="text-xl font-semibold mb-4">YOLO Bounding Box Format</h2>
              {yoloString ? (
                <div className="space-y-4">
                  <pre className="bg-gray-900 rounded-md p-4 text-cyan-300 overflow-x-auto text-sm max-h-48">
                    <code>{yoloString}</code>
                  </pre>
                  <div className="flex space-x-2">
                    <button
                      onClick={handleCopy}
                      className="flex items-center justify-center w-full px-4 py-2 bg-cyan-600 hover:bg-cyan-500 text-white font-semibold rounded-md transition-colors"
                    >
                      {isCopied ? (<><CheckIcon className="w-5 h-5 mr-2" />Copied!</>) : (<><ClipboardIcon className="w-5 h-5 mr-2" />Copy</>)}
                    </button>
                    <button
                      onClick={handleSaveToFile}
                      disabled={!fileName || isSavingToDrive || !isGoogleConfigured}
                      className="flex items-center justify-center w-full px-4 py-2 bg-gray-700 hover:bg-gray-600 text-white font-semibold rounded-md transition-colors disabled:opacity-50 disabled:cursor-not-allowed"
                    >
                      {driveFileMeta ? <GoogleDriveIcon className="w-5 h-5 mr-2" /> : <DownloadIcon className="w-5 h-5 mr-2" />}
                      {isSavingToDrive ? 'Saving...' : (driveFileMeta ? 'Save to Drive' : 'Save to .txt')}
                    </button>
                  </div>
                </div>
              ) : (
                <p className="text-gray-500">Selection coordinates in YOLO format will appear here.</p>
              )}
            </div>
          </div>
        </div>
      </main>
    </div>
  );
};

export default App;
