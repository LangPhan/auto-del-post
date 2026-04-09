import { defineManifest } from '@crxjs/vite-plugin'
import pkg from './package.json'

export default defineManifest({
  manifest_version: 3,
  name: 'Bộ công cụ Facebook',
  version: pkg.version,
  icons: {
    48: 'public/logo.png',
  },
  action: {
    default_icon: {
      48: 'public/logo.png',
    },
    default_popup: 'src/popup/index.html',
  },
  permissions: [
    'sidePanel',
    'storage',
    'activeTab',
    'scripting',
  ],
  host_permissions: [
    'https://*.facebook.com/*',
  ],
  content_scripts: [{
    js: ['src/content/main.ts'],
    matches: ['https://*.facebook.com/*'],
    run_at: 'document_idle',
  }],
  side_panel: {
    default_path: 'src/sidepanel/index.html',
  },
})
