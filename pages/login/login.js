document.addEventListener('DOMContentLoaded', () => {
    const form = document.getElementById('loginForm');

    form.addEventListener('submit', async function(e) {
        e.preventDefault();

        const email = document.getElementById('email').value.trim();
        const senha = document.getElementById('password').value;

        const btn = document.querySelector('.login-btn');
        const btnText = document.querySelector('.btn-text');
        const loader = document.querySelector('.loader');

        btnText.style.opacity = '0';
        loader.classList.remove('hidden');
        btn.style.pointerEvents = 'none';

        try {
            // Usa window.API_BASE definido globalmente em config.js
            const res = await fetch(`${API_BASE}/login`, {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({ email, senha })
            });

            const data = await res.json();

            if (res.ok && data.token) {
                localStorage.setItem('sensorium_token', data.token);
                if (data.usuario) {
                    localStorage.setItem('sensorium_user', JSON.stringify(data.usuario));
                    if (data.usuario.perfil === 'superadmin') {
                        window.location.href = '../admin/index.html';
                        return;
                    }
                    if (data.usuario.perfil === 'apresentacao') {
                        window.location.href = '../chopeiras/index.html';
                        return;
                    }
                }
                window.location.href = '../home/index.html';
            } else {
                alert(data.erro || 'Falha na autenticação. Verifique e-mail e senha.');
                resetBtn();
            }
        } catch (err) {
            console.warn('[Login] Servidor offline ou indisponível, prosseguindo modo estático:', err.message);
            setTimeout(() => {
                window.location.href = '../home/index.html';
            }, 800);
        }

        function resetBtn() {
            btnText.style.opacity = '1';
            loader.classList.add('hidden');
            btn.style.pointerEvents = 'auto';
        }
    });
});
