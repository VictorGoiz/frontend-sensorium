/**
 * ============================================================================
 * SENSIMONITOR - NOTIFICAÇÕES TOAST & FEEDBACK VISUAL (UI)
 * ============================================================================
 */
(function (global) {
    'use strict';

    let toastTimer = null;

    function showToast(message, type = 'success', elementId = 'toast') {
        const toast = document.getElementById(elementId);
        if (!toast) return;

        toast.className = `toast-feedback ${type === 'success' ? 'toast-success' : 'toast-error'}`;
        toast.innerText = message;
        toast.style.display = 'block';

        if (toastTimer) clearTimeout(toastTimer);
        toastTimer = setTimeout(() => {
            toast.style.display = 'none';
        }, 3500);
    }

    global.showToast = showToast;
    global.SensoriumToast = { showToast };
})(window);
