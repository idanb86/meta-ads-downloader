// background.js — Meta Ads Downloader (MV3 compatible)
// Handles only chrome.downloads — media capture is done in content script via fetch/XHR hooks

chrome.runtime.onMessage.addListener((message, sender, sendResponse) => {

  if (message.type === 'DOWNLOAD') {
    handleDownload(message.url, message.filename)
      .then(() => sendResponse({ success: true }))
      .catch(err => sendResponse({ success: false, error: err.message }));
    return true; // keep async channel open
  }

  return true;
});

async function handleDownload(url, filename) {
  return new Promise((resolve, reject) => {
    chrome.downloads.download(
      {
        url,
        filename: sanitizeFilename(filename),
        saveAs: false,
        conflictAction: 'uniquify'
      },
      (downloadId) => {
        if (chrome.runtime.lastError) {
          reject(new Error(chrome.runtime.lastError.message));
        } else {
          resolve(downloadId);
        }
      }
    );
  });
}

function sanitizeFilename(name) {
  return (name || 'download')
    .replace(/[<>:"/\\|?*\x00-\x1f]/g, '_')
    .replace(/\s+/g, '_')
    .replace(/_+/g, '_')
    .substring(0, 200);
}

console.log('[MAD] Background service worker ready ✓');
