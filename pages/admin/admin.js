document.addEventListener('DOMContentLoaded', () => {
    
    // Proteção da rota
    const token = localStorage.getItem('sensorium_token');
    const userStr = localStorage.getItem('sensorium_user');
    
    if (!token || !userStr) {
        window.location.href = '../login/index.html';
        return;
    }

    const user = JSON.parse(userStr);
    if (user.perfil !== 'superadmin') {
        alert('Acesso negado. Apenas Super Admins podem acessar esta página.');
        window.location.href = '../home/index.html';
        return;
    }

    loadEmpresas();

    const formEmpresa = document.getElementById('formEmpresa');
    const formUsuario = document.getElementById('formUsuario');
    const btnEmpresa = document.getElementById('btnSubmitEmpresa');
    const btnUsuario = document.getElementById('btnSubmitUsuario');

    formEmpresa.addEventListener('submit', async (e) => {
        e.preventDefault();
        
        const nome = document.getElementById('nomeEmpresa').value.trim();
        const cnpj = document.getElementById('cnpjEmpresa').value.trim();

        if (btnEmpresa) {
            btnEmpresa.disabled = true;
            btnEmpresa.innerHTML = '<span>Cadastrando...</span>';
        }

        try {
            const res = await fetch(`${API_BASE}/api/admin/empresas`, {
                method: 'POST',
                headers: {
                    'Content-Type': 'application/json',
                    'Authorization': `Bearer ${token}`
                },
                body: JSON.stringify({ nome, cnpj })
            });
            const data = await res.json();

            if (res.ok && data.success) {
                showToast(data.message || 'Cliente cadastrado com sucesso!', 'success');
                formEmpresa.reset();
                await loadEmpresas(); // Recarrega lista do select
            } else {
                showToast(data.message || 'Erro ao cadastrar cliente.', 'error');
            }
        } catch (error) {
            console.error('Erro ao cadastrar cliente:', error);
            showToast('Erro de conexão ao cadastrar cliente.', 'error');
        } finally {
            if (btnEmpresa) {
                btnEmpresa.disabled = false;
                btnEmpresa.innerHTML = '<span>Cadastrar Cliente</span>';
            }
        }
    });

    formUsuario.addEventListener('submit', async (e) => {
        e.preventDefault();
        
        const empresa_id = document.getElementById('selectEmpresa').value;
        const nome = document.getElementById('nomeUsuario').value.trim();
        const email = document.getElementById('emailUsuario').value.trim();
        const senha = document.getElementById('senhaUsuario').value;
        const perfil = document.getElementById('perfilUsuario').value;

        if (!empresa_id) {
            showToast('Por favor, selecione um cliente vinculado.', 'error');
            return;
        }

        if (btnUsuario) {
            btnUsuario.disabled = true;
            btnUsuario.innerHTML = '<span>Cadastrando...</span>';
        }

        try {
            const res = await fetch(`${API_BASE}/api/admin/usuarios`, {
                method: 'POST',
                headers: {
                    'Content-Type': 'application/json',
                    'Authorization': `Bearer ${token}`
                },
                body: JSON.stringify({ empresa_id, nome, email, senha, perfil })
            });
            const data = await res.json();

            if (res.ok && data.success) {
                showToast(data.message || 'Usuário criado com sucesso!', 'success');
                formUsuario.reset();
            } else {
                showToast(data.message || 'Erro ao criar usuário.', 'error');
            }
        } catch (error) {
            console.error('Erro ao criar usuário:', error);
            showToast('Erro de conexão ao criar usuário.', 'error');
        } finally {
            if (btnUsuario) {
                btnUsuario.disabled = false;
                btnUsuario.innerHTML = '<span>Cadastrar Usuário</span>';
            }
        }
    });

    async function loadEmpresas() {
        const select = document.getElementById('selectEmpresa');
        try {
            const res = await fetch(`${API_BASE}/api/admin/empresas`, {
                headers: {
                    'Authorization': `Bearer ${token}`
                }
            });
            const data = await res.json();

            if (select) {
                select.innerHTML = '<option value="">Selecione um cliente...</option>';

                if (data.success && data.data && data.data.length > 0) {
                    data.data.forEach(empresa => {
                        const option = document.createElement('option');
                        option.value = empresa.id;
                        option.textContent = empresa.nome + (empresa.cnpj ? ` (${empresa.cnpj})` : '');
                        select.appendChild(option);
                    });
                } else {
                    select.innerHTML = '<option value="">Nenhum cliente encontrado (cadastre um primeiro)</option>';
                }
            }
        } catch (error) {
            console.error('Erro ao carregar clientes:', error);
            if (select) select.innerHTML = '<option value="">Erro ao carregar lista de clientes</option>';
        }
    }

    function showToast(message, type = 'success') {
        const toast = document.getElementById('toast');
        if (!toast) return;

        toast.className = `toast-feedback ${type === 'success' ? 'toast-success' : 'toast-error'}`;
        toast.innerText = message;
        toast.style.display = 'block';

        setTimeout(() => {
            toast.style.display = 'none';
        }, 3500);
    }
});

