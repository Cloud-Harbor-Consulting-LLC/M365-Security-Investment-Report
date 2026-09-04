import { render } from 'preact';

import '@/styles/tokens.css';
import '@/styles/app.css';
import { App } from '@/app';

const root = document.getElementById('app');
if (!root) throw new Error('Missing #app mount point.');

render(<App />, root);
