document.addEventListener('DOMContentLoaded', function() {
    const userStr = localStorage.getItem('sensorium_user');
    if (userStr) {
        try {
            const user = JSON.parse(userStr);
            if (user.perfil === 'apresentacao') {
                window.location.href = '../chopeiras/index.html';
                return;
            }
        } catch (e) {}
    }

    // Gráfico de Temperatura Global (Linha)
    const trafficEl = document.getElementById('trafficChart');
    if (trafficEl) {
        const ctxTraffic = trafficEl.getContext('2d');
        new Chart(ctxTraffic, {
            type: 'line',
            data: {
                labels: ['00:00', '04:00', '08:00', '12:00', '16:00', '20:00', '24:00'],
                datasets: [
                    {
                        label: 'Temperatura Média Global',
                        data: [-1.2, -1.8, -2.1, -1.5, -1.1, -1.4, -1.6],
                        borderColor: '#fac800',
                        backgroundColor: 'rgba(250, 200, 0, 0.1)',
                        borderWidth: 3,
                        tension: 0.4,
                        fill: true
                    },
                    {
                        label: 'Ponto de Alerta Global',
                        data: [-2.5, -2.5, -2.5, -2.5, -2.5, -2.5, -2.5],
                        borderColor: '#d32f2f',
                        borderWidth: 2,
                        borderDash: [5, 5],
                        pointRadius: 0,
                        fill: false
                    }
                ]
            },
            options: {
                responsive: true,
                maintainAspectRatio: false,
                plugins: {
                    legend: { display: false }
                },
                scales: {
                    y: { suggestedMin: -3.0, suggestedMax: 0 }
                }
            }
        });
    }

    // Gráfico de Status Térmico (Rosca)
    const statusEl = document.getElementById('statusChart');
    if (statusEl) {
        const ctxStatus = statusEl.getContext('2d');
        new Chart(ctxStatus, {
            type: 'doughnut',
            data: {
                labels: ['Margem Segura', 'Risco', 'Congelando'],
                datasets: [{
                    data: [110, 10, 4],
                    backgroundColor: [
                        '#208b3a', // Verde
                        '#fac800', // Amarelo
                        '#d32f2f'  // Vermelho
                    ],
                    borderWidth: 0
                }]
            },
            options: {
                responsive: true,
                maintainAspectRatio: false,
                cutout: '70%',
                plugins: {
                    legend: { position: 'bottom' }
                }
            }
        });
    }
});

function toggleNavDropdown(btn) {
    const dropdown = btn.closest('.nav-dropdown');
    if (dropdown) {
        dropdown.classList.toggle('open');
    }
}

