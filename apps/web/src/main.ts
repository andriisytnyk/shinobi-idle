import { mount } from 'svelte';
import App from './App.svelte';
import { game } from './lib/store.ts';
import './fonts.css';
import './tokens.css';
import './app.css';

const target = document.getElementById('app');
if (!target) throw new Error('Missing #app element');

// The game loads its save and starts ticking in the background; the shell renders at once.
void game.start();

export default mount(App, { target });
