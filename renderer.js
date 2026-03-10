const { ipcRenderer } = require('electron');

// UI Elements
const previewVideo = document.getElementById('preview-video');
const previewImage = document.getElementById('preview-image');
const noPreview = document.getElementById('no-preview');
const activeName = document.getElementById('active-name');
const activeType = document.getElementById('active-type');
const importMediaBtn = document.getElementById('import-media');
const mediaGrid = document.getElementById('media-grid');
const statusText = document.getElementById('status-text');
const navItems = document.querySelectorAll('.nav-item');
const viewPanels = document.querySelectorAll('.view-panel');

// Settings Elements
const startupToggle = document.getElementById('startup-toggle');
const blurSlider = document.getElementById('blur-slider');
const blurValueDisplay = document.getElementById('blur-value');

function setStatus(text) {
    statusText.textContent = text;
}

function updatePreview(item) {
    previewVideo.pause();
    previewVideo.src = '';
    previewVideo.classList.add('hidden');
    previewImage.src = '';
    previewImage.classList.add('hidden');
    noPreview.classList.add('hidden');

    activeName.textContent = item.name;
    activeType.textContent = item.type.toUpperCase();

    if (item.type === 'video') {
        previewVideo.src = item.url;
        previewVideo.classList.remove('hidden');
        previewVideo.play().catch(e => console.error('Preview Play Error:', e));
    } else {
        previewImage.src = item.url;
        previewImage.classList.remove('hidden');
    }
}

async function loadMediaList() {
    const media = await ipcRenderer.invoke('list-media');
    renderGrid(media);
}

function renderGrid(media) {
    mediaGrid.innerHTML = '';
    media.forEach(item => {
        const div = document.createElement('div');
        div.className = 'media-item';
        div.title = item.name;

        // For video thumbnails, use #t=0.1 to show the first frame
        const finalUrl = item.type === 'video' ? `${item.url}#t=0.1` : item.url;

        if (item.type === 'video') {
            const v = document.createElement('video');
            v.src = finalUrl;
            v.muted = true;
            v.preload = "metadata";
            div.appendChild(v);
            const span = document.createElement('span');
            span.className = 'type-badge';
            span.textContent = 'VIDEO';
            div.appendChild(span);
        } else {
            const img = document.createElement('img');
            img.src = finalUrl;
            div.appendChild(img);
            const span = document.createElement('span');
            span.className = 'type-badge';
            span.textContent = 'IMAGE';
            div.appendChild(span);
        }

        div.addEventListener('click', () => {
            setWallpaper(item);
            document.querySelectorAll('.media-item').forEach(i => i.classList.remove('selected'));
            div.classList.add('selected');
        });

        mediaGrid.appendChild(div);
    });
}

function setWallpaper(item) {
    updatePreview(item);
    ipcRenderer.send('set-wallpaper', item);
    setStatus(`Wallpaper set: ${item.name}`);
}

importMediaBtn.addEventListener('click', async () => {
    setStatus('Importing media...');
    const imported = await ipcRenderer.invoke('import-media');
    if (imported && imported.length > 0) {
        setStatus(`Imported ${imported.length} files`);
        loadMediaList();
    } else {
        setStatus('Import canceled');
    }
});

// Sidebar Navigation
navItems.forEach(item => {
    item.addEventListener('click', () => {
        const targetView = item.getAttribute('data-view');

        // Update nav items
        navItems.forEach(i => i.classList.remove('active'));
        item.classList.add('active');


        // Show/Hide panels
        viewPanels.forEach(panel => {
            if (panel.id === `${targetView}-view`) {
                panel.classList.add('active');
            } else {
                panel.classList.remove('active');
            }
        });
    });
});

// Settings Management
async function initSettings() {
    const settings = await ipcRenderer.invoke('get-settings');
    startupToggle.checked = settings.startup;
    blurSlider.value = settings.blur;
    blurValueDisplay.textContent = `${settings.blur}px`;
}

async function updateSettings() {
    const settings = {
        startup: startupToggle.checked,
        blur: parseInt(blurSlider.value)
    };
    await ipcRenderer.invoke('update-settings', settings);
}

startupToggle.addEventListener('change', updateSettings);
blurSlider.addEventListener('input', () => {
    blurValueDisplay.textContent = `${blurSlider.value}px`;
    updateSettings();
});

// Initialize
initSettings();
loadMediaList();
