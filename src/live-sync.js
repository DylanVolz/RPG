/**
 * src/live-sync.js — Synchronisation live entre onglets Studio
 *
 * Utilise BroadcastChannel (même origin, localhost:3000).
 * Aucune dépendance. Import en ES module.
 *
 * Usage :
 *   import { LiveSync } from './src/live-sync.js';
 *
 *   // Émettre
 *   LiveSync.broadcast('char-updated', { name: 'Elara' });
 *
 *   // Recevoir
 *   LiveSync.on('char-updated', data => { ... });
 */
export const LiveSync = {
    _ch       : null,
    _listeners: {},

    _init() {
        if (this._ch) return;
        if (!window.BroadcastChannel) {
            console.warn('[LiveSync] BroadcastChannel non supporté — live sync désactivé.');
            return;
        }
        this._ch = new BroadcastChannel('threejs_game_editor');
        this._ch.onmessage = ({ data }) => {
            const { type, payload } = data;
            (this._listeners[type] || []).forEach(fn => fn(payload));
            (this._listeners['*']  || []).forEach(fn => fn(type, payload));
        };
    },

    /**
     * Envoie un message à tous les autres onglets du studio.
     * @param {string} type   — identifiant du message (ex: 'char-updated')
     * @param {object} payload — données à transmettre (optionnel)
     */
    broadcast(type, payload = {}) {
        this._init();
        if (!this._ch) return;
        this._ch.postMessage({ type, payload, ts: Date.now() });
    },

    /**
     * S'abonner à un type de message.
     * @param {string}   type — type ou '*' pour tout recevoir
     * @param {Function} fn   — callback(payload) ou callback(type, payload) pour '*'
     * @returns {Function} fonction de désabonnement
     */
    on(type, fn) {
        this._init();
        (this._listeners[type] ??= []).push(fn);
        return () => this.off(type, fn);
    },

    off(type, fn) {
        if (!this._listeners[type]) return;
        this._listeners[type] = this._listeners[type].filter(f => f !== fn);
    },
};
