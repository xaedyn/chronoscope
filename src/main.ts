import './app.css';
import App from './lib/components/App.svelte';
import { mount } from 'svelte';

const appTarget = document.getElementById('app');
if (!appTarget) throw new Error('Mount target #app not found');
const app = mount(App, { target: appTarget });

export default app;
