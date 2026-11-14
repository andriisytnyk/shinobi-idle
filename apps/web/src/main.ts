import { mount } from 'svelte';
import App from './App.svelte';
import './fonts.css';
import './tokens.css';
import './app.css';

const target = document.getElementById('app');
if (!target) throw new Error('Missing #app element');

export default mount(App, { target });
