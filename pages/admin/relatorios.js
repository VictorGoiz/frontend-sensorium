// ==========================================================================
// SENSIMONITOR ADMIN // RELATÓRIOS & ASSISTENTE DE IA (LFG60 / LLM)
// ==========================================================================

// Variável de URL base da LLM (ai.sensimonitor.com.br)
const LLM_API_BASE = window.LLM_API_BASE || "https://ai.sensimonitor.com.br/api";

const chatForm = document.getElementById("chat-form");
const messageInput = document.getElementById("message-input");
const chatMessages = document.getElementById("chat-messages");
const btnSend = document.getElementById("btn-send");
const btnClear = document.getElementById("btn-clear");
const btnQuickLFG60 = document.getElementById("btn-quick-lfg60");
const quickSuggestions = document.getElementById("quick-suggestions");

function getHeaders() {
    const token = localStorage.getItem("sensorium_token");
    const headers = {
        "Content-Type": "application/json"
    };
    if (token) {
        headers["Authorization"] = `Bearer ${token}`;
    }
    return headers;
}

// 1. Envio de mensagem ou dados de telemetria
if (chatForm) {
    chatForm.addEventListener("submit", async (event) => {
        event.preventDefault();

        const userText = messageInput.value.trim();
        if (!userText) return;

        messageInput.value = "";
        messageInput.style.height = "auto";

        addMessage("user", userText);

        const typingElement = showTypingIndicator();
        if (btnSend) btnSend.disabled = true;

        try {
            let isSensorJson = false;
            let parsedData = null;

            // Identifica se o usuário enviou um objeto JSON de sensores
            try {
                if (userText.startsWith("{") && userText.endsWith("}")) {
                    parsedData = JSON.parse(userText);
                    isSensorJson = true;
                }
            } catch (_) {
                isSensorJson = false;
            }

            const endpoint = isSensorJson ? `${LLM_API_BASE}/analyze` : `${LLM_API_BASE}/chat`;
            const payload = isSensorJson ? parsedData : { message: userText };

            const response = await fetch(endpoint, {
                method: "POST",
                headers: getHeaders(),
                body: JSON.stringify(payload)
            });

            const data = await response.json();
            typingElement.remove();

            if (response.ok) {
                const replyText = data.analysis || data.message || "Análise concluída.";
                const sensorPayloadForPdf = isSensorJson ? parsedData : null;
                addMessage("assistant", replyText, sensorPayloadForPdf);
            } else {
                addMessage("assistant", `[Erro]: ${data.error || data.message || "Falha ao processar solicitação."}`);
            }

        } catch (error) {
            typingElement.remove();
            addMessage("assistant", `[Erro]: Não foi possível conectar ao endpoint do servidor (${LLM_API_BASE}).`);
        } finally {
            if (btnSend) btnSend.disabled = false;
            messageInput.focus();
        }
    });
}

// 2. Atalhos de Teclado
if (messageInput) {
    messageInput.addEventListener("keydown", (event) => {
        if (event.key === "Enter" && !event.shiftKey) {
            event.preventDefault();
            chatForm.requestSubmit();
        }
    });

    // 3. Ajuste de altura do Textarea
    messageInput.addEventListener("input", () => {
        messageInput.style.height = "auto";
        messageInput.style.height = `${Math.min(messageInput.scrollHeight, 120)}px`;
    });
}

// 4. Limpar Histórico
if (btnClear) {
    btnClear.addEventListener("click", async () => {
        try {
            await fetch(`${LLM_API_BASE}/chat`, { 
                method: "DELETE",
                headers: getHeaders()
            });
        } catch (e) {
            console.warn("Erro ao limpar histórico:", e);
        }

        chatMessages.innerHTML = `
            <div class="welcome-card-box">
                <h2>Histórico Reiniciado</h2>
                <p>O histórico de conversas foi limpo com sucesso.</p>
                <div class="quick-prompts-row" id="quick-suggestions">
                    <button type="button" class="prompt-chip" data-text='{"temperatura":37.5,"umidade":55.0,"co2":450,"pm25":10.2,"pm10":18.0,"voc":0.15,"formaldeido":0.02}'>
                        Telemetria LFG60 (Exemplo Real)
                    </button>
                    <button type="button" class="prompt-chip" data-text="Quais são os limites recomendados de PM2.5 e PM10 segundo as normas vigentes?">
                        Limites de PM2.5 e PM10
                    </button>
                    <button type="button" class="prompt-chip" data-text="Qual a concentração segura de CO2 e Formaldeído em ambientes fechados?">
                        Parâmetros de CO2 e Formaldeído
                    </button>
                </div>
            </div>
        `;
    });
}

// 5. Botão de Análise Rápida do Sensor LFG60 no Cabeçalho
if (btnQuickLFG60) {
    btnQuickLFG60.addEventListener("click", () => {
        const lfg60Payload = JSON.stringify({
            temperatura: 24.5,
            umidade: 55.0,
            co2: 450,
            pm25: 10.2,
            pm10: 18.0,
            voc: 0.15,
            formaldeido: 0.02
        });
        messageInput.value = lfg60Payload;
        chatForm.requestSubmit();
    });
}

// 6. Sugestões Rápidas (Event Delegation no chatMessages)
if (chatMessages) {
    chatMessages.addEventListener("click", (event) => {
        const btn = event.target.closest(".prompt-chip") || event.target.closest(".prompt-btn");
        if (btn) {
            messageInput.value = btn.getAttribute("data-text");
            messageInput.focus();
        }
    });
}

// 7. Clique nos botões de Download de PDF e Envio por E-mail
if (chatMessages) {
    chatMessages.addEventListener("click", async (event) => {
        // Ação 1: Download de PDF
        const pdfBtn = event.target.closest(".btn-download-pdf");
        if (pdfBtn) {
            const rawData = pdfBtn.getAttribute("data-sensor");
            const analysisText = pdfBtn.getAttribute("data-analysis");

            if (rawData) {
                try {
                    pdfBtn.textContent = "Gerando PDF...";
                    pdfBtn.disabled = true;

                    const sensorData = JSON.parse(decodeURIComponent(rawData));
                    const analysis = decodeURIComponent(analysisText || "");

                    const response = await fetch(`${LLM_API_BASE}/analyze/pdf`, {
                        method: "POST",
                        headers: getHeaders(),
                        body: JSON.stringify({
                            data: sensorData,
                            analysis
                        })
                    });

                    if (!response.ok) throw new Error("Falha ao gerar o PDF no servidor.");

                    const blob = await response.blob();
                    const downloadUrl = window.URL.createObjectURL(blob);
                    const a = document.createElement("a");
                    a.href = downloadUrl;
                    a.download = `relatorio_lfg60_${Date.now()}.pdf`;
                    document.body.appendChild(a);
                    a.click();
                    a.remove();
                    window.URL.revokeObjectURL(downloadUrl);

                    pdfBtn.textContent = "✓ PDF Baixado";
                    setTimeout(() => {
                        pdfBtn.textContent = "Baixar Relatório PDF";
                        pdfBtn.disabled = false;
                    }, 2500);

                } catch (err) {
                    console.error("Erro ao baixar PDF:", err);
                    alert("Erro ao gerar o arquivo PDF.");
                    pdfBtn.textContent = "Baixar Relatório PDF";
                    pdfBtn.disabled = false;
                }
            }
            return;
        }

        // Ação 2: Enviar por E-mail Imediato (Abre modal)
        const emailBtn = event.target.closest(".btn-send-email");
        if (emailBtn) {
            const rawData = emailBtn.getAttribute("data-sensor");
            const analysisText = emailBtn.getAttribute("data-analysis");

            if (rawData) {
                openInstantEmailModal({
                    rawSensorData: rawData,
                    analysisText: analysisText,
                    sourceButton: emailBtn
                });
            }
        }
    });
}

// ==========================================================================
// 8. Controle do Modal de Envio Rápido por E-mail
// ==========================================================================
const emailModal = document.getElementById("email-modal");
const btnCloseEmailModal = document.getElementById("btn-close-email-modal");
const btnCancelEmail = document.getElementById("btn-cancel-email");
const btnConfirmSendEmail = document.getElementById("btn-confirm-send-email");
const instantEmailRecipient = document.getElementById("instant-email-recipient");
const instantEmailSubject = document.getElementById("instant-email-subject");
const instantEmailFeedback = document.getElementById("instant-email-feedback");

let currentEmailPayload = null;

function openInstantEmailModal({ rawSensorData, analysisText, sourceButton }) {
    currentEmailPayload = {
        sensorData: JSON.parse(decodeURIComponent(rawSensorData)),
        analysis: decodeURIComponent(analysisText || ""),
        sourceButton
    };

    const savedEmail = localStorage.getItem("sensimonitor_recipient_email") || "contato@empresa.com";
    if (instantEmailRecipient) {
        instantEmailRecipient.value = savedEmail;
    }

    if (instantEmailSubject) {
        const nowStr = new Date().toLocaleDateString("pt-BR");
        instantEmailSubject.value = `[SensiMonitor] Relatório Técnico Ambiental LFG60 - ${nowStr}`;
    }

    if (instantEmailFeedback) {
        instantEmailFeedback.style.display = "none";
        instantEmailFeedback.textContent = "";
    }

    if (emailModal) {
        emailModal.style.display = "flex";
        if (instantEmailRecipient) instantEmailRecipient.focus();
    }
}

function closeInstantEmailModal() {
    if (emailModal) emailModal.style.display = "none";
    currentEmailPayload = null;
}

if (btnCloseEmailModal) btnCloseEmailModal.addEventListener("click", closeInstantEmailModal);
if (btnCancelEmail) btnCancelEmail.addEventListener("click", closeInstantEmailModal);

if (btnConfirmSendEmail) {
    btnConfirmSendEmail.addEventListener("click", async () => {
        if (!currentEmailPayload) return;

        const recipient = instantEmailRecipient.value.trim();
        const subject = instantEmailSubject.value.trim();

        if (!recipient || !recipient.includes("@")) {
            showInstantEmailFeedback("Por favor, digite um endereço de e-mail válido.", "error");
            return;
        }

        localStorage.setItem("sensimonitor_recipient_email", recipient);

        try {
            btnConfirmSendEmail.textContent = "Enviando...";
            btnConfirmSendEmail.disabled = true;
            showInstantEmailFeedback("Gerando parecer e enviando relatório por e-mail...", "info");

            const response = await fetch(`${LLM_API_BASE}/lfg60/email/send`, {
                method: "POST",
                headers: getHeaders(),
                body: JSON.stringify({
                    to: recipient,
                    subject: subject || undefined,
                    data: currentEmailPayload.sensorData,
                    analysis: currentEmailPayload.analysis
                })
            });

            const result = await response.json();
            if (response.ok && result.success) {
                showInstantEmailFeedback(`✓ Relatório enviado com sucesso para ${recipient}!`, "success");
                if (currentEmailPayload.sourceButton) {
                    currentEmailPayload.sourceButton.textContent = "✓ E-mail Enviado";
                }
                setTimeout(() => {
                    closeInstantEmailModal();
                    btnConfirmSendEmail.textContent = "Enviar Relatório";
                    btnConfirmSendEmail.disabled = false;
                }, 1800);
            } else {
                showInstantEmailFeedback(`Erro ao enviar: ${result.error || result.message || "Falha na comunicação."}`, "error");
                btnConfirmSendEmail.textContent = "Enviar Relatório";
                btnConfirmSendEmail.disabled = false;
            }
        } catch (err) {
            console.error("Erro ao enviar e-mail:", err);
            showInstantEmailFeedback("Erro de conexão ao enviar o relatório.", "error");
            btnConfirmSendEmail.textContent = "Enviar Relatório";
            btnConfirmSendEmail.disabled = false;
        }
    });
}

function showInstantEmailFeedback(msg, type) {
    if (!instantEmailFeedback) return;
    instantEmailFeedback.style.display = "block";
    instantEmailFeedback.textContent = msg;

    if (type === "success") {
        instantEmailFeedback.style.backgroundColor = "rgba(16, 185, 129, 0.12)";
        instantEmailFeedback.style.border = "1px solid #10b981";
        instantEmailFeedback.style.color = "#065f46";
    } else if (type === "error") {
        instantEmailFeedback.style.backgroundColor = "rgba(239, 68, 68, 0.12)";
        instantEmailFeedback.style.border = "1px solid #ef4444";
        instantEmailFeedback.style.color = "#991b1b";
    } else {
        instantEmailFeedback.style.backgroundColor = "rgba(30, 96, 172, 0.12)";
        instantEmailFeedback.style.border = "1px solid #1e60ac";
        instantEmailFeedback.style.color = "#1e60ac";
    }
}

// ==========================================================================
// 9. Controle do Modal de Agendamento
// ==========================================================================
const btnOpenSchedule = document.getElementById("btn-open-schedule");
const btnCloseModal = document.getElementById("btn-close-modal");
const scheduleModal = document.getElementById("schedule-modal");
const scheduleRecipient = document.getElementById("schedule-recipient");
const scheduleTime = document.getElementById("schedule-time");
const scheduleActive = document.getElementById("schedule-active");
const scheduleStatusInfo = document.getElementById("schedule-status-info");
const btnSaveSchedule = document.getElementById("btn-save-schedule");
const btnTriggerNow = document.getElementById("btn-trigger-now");

async function loadScheduleStatus() {
    if (!scheduleStatusInfo) return;
    try {
        const response = await fetch(`${LLM_API_BASE}/lfg60/schedule`, {
            headers: getHeaders()
        });
        if (response.ok) {
            const data = await response.json();
            const savedEmail = localStorage.getItem("sensimonitor_recipient_email") || data.recipient || "gestao@empresa.com";
            if (scheduleRecipient) scheduleRecipient.value = savedEmail;
            if (scheduleTime && data.time && data.time.includes(":")) scheduleTime.value = data.time;
            if (scheduleActive) scheduleActive.checked = Boolean(data.active);

            const lastRunFormatted = data.lastRun ? new Date(data.lastRun).toLocaleString("pt-BR") : "Nenhum ainda";
            scheduleStatusInfo.innerHTML = `
                <div><strong>Status:</strong> ${data.active ? '<span style="color:#10b981; font-weight:600;">Ativo</span>' : '<span style="color:#ef4444; font-weight:600;">Pausado</span>'}</div>
                <div><strong>Horário Configurado:</strong> ${data.time || "08:00"} (${data.timezone || "America/Sao_Paulo"})</div>
                <div><strong>Destinatário Atual:</strong> ${data.recipient || "Não configurado"}</div>
                <div><strong>Último Disparo:</strong> ${lastRunFormatted} (${data.lastStatus || "Pendente"})</div>
            `;
        }
    } catch (err) {
        scheduleStatusInfo.textContent = "Não foi possível carregar o status do agendador.";
    }
}

if (btnOpenSchedule) {
    btnOpenSchedule.addEventListener("click", () => {
        if (scheduleModal) scheduleModal.style.display = "flex";
        loadScheduleStatus();
    });
}

if (btnCloseModal) {
    btnCloseModal.addEventListener("click", () => {
        if (scheduleModal) scheduleModal.style.display = "none";
    });
}

window.addEventListener("click", (event) => {
    if (event.target === scheduleModal) {
        scheduleModal.style.display = "none";
    }
    if (event.target === emailModal) {
        closeInstantEmailModal();
    }
});

if (btnSaveSchedule) {
    btnSaveSchedule.addEventListener("click", async () => {
        const time = scheduleTime.value;
        const recipient = scheduleRecipient.value.trim();
        const active = scheduleActive.checked;

        if (!recipient || !recipient.includes("@")) {
            alert("Por favor, preencha um e-mail de destinatário válido.");
            return;
        }

        localStorage.setItem("sensimonitor_recipient_email", recipient);

        try {
            btnSaveSchedule.textContent = "Salvando...";
            btnSaveSchedule.disabled = true;

            const response = await fetch(`${LLM_API_BASE}/lfg60/schedule`, {
                method: "POST",
                headers: getHeaders(),
                body: JSON.stringify({ time, recipient, active })
            });

            const data = await response.json();
            if (response.ok && data.success) {
                alert(`✓ Configurações salvas com sucesso! E-mail configurado: ${recipient}`);
                loadScheduleStatus();
            } else {
                alert(`Erro ao salvar: ${data.error || data.message || "Falha desconhecida"}`);
            }
        } catch (err) {
            alert("Erro ao conectar ao servidor para atualizar agendamento.");
        } finally {
            btnSaveSchedule.textContent = "Salvar Configurações";
            btnSaveSchedule.disabled = false;
        }
    });
}

if (btnTriggerNow) {
    btnTriggerNow.addEventListener("click", async () => {
        const recipient = scheduleRecipient.value.trim();
        if (!confirm(`Deseja disparar agora a geração e envio do relatório para ${recipient || "o destinatário padrão"}?`)) {
            return;
        }

        try {
            btnTriggerNow.textContent = "Disparando...";
            btnTriggerNow.disabled = true;

            const response = await fetch(`${LLM_API_BASE}/lfg60/schedule/trigger`, {
                method: "POST",
                headers: getHeaders(),
                body: JSON.stringify({ to: recipient })
            });

            const data = await response.json();
            if (response.ok && data.success) {
                alert(`✓ Disparo executado com sucesso! Relatório gerado e enviado para ${recipient}.`);
                loadScheduleStatus();
            } else {
                alert(`Erro no disparo: ${data.error || data.message || "Falha desconhecida"}`);
            }
        } catch (err) {
            alert("Erro ao conectar ao servidor para disparar agendamento.");
        } finally {
            btnTriggerNow.textContent = "Disparar Agora";
            btnTriggerNow.disabled = false;
        }
    });
}

// ==========================================================================
// Funções Auxiliares de Interface
// ==========================================================================

function addMessage(sender, text, sensorDataForPdf = null) {
    const row = document.createElement("div");
    row.className = `chat-msg-row ${sender}`;

    const authorName = sender === "user" ? "Usuário" : "SensiMonitor (Análise LFG60)";
    const time = new Date().toLocaleTimeString([], { hour: "2-digit", minute: "2-digit" });
    const formatted = formatText(text);

    let pdfActionHtml = "";
    if (sensorDataForPdf) {
        const encodedData = encodeURIComponent(JSON.stringify(sensorDataForPdf));
        const encodedAnalysis = encodeURIComponent(text);
        pdfActionHtml = `
            <div style="margin-top: 10px; padding-top: 8px; border-top: 1px solid #e2e8f0; display: flex; gap: 8px; flex-wrap: wrap;">
                <button type="button" class="btn-chat-action btn-chat-primary btn-download-pdf" 
                    data-sensor="${encodedData}" 
                    data-analysis="${encodedAnalysis}"
                    style="padding: 4px 10px; font-size: 11.5px;">
                    Baixar Relatório PDF
                </button>
                <button type="button" class="btn-chat-action btn-send-email" 
                    data-sensor="${encodedData}" 
                    data-analysis="${encodedAnalysis}"
                    style="padding: 4px 10px; font-size: 11.5px;">
                    Enviar por E-mail
                </button>
            </div>
        `;
    }

    row.innerHTML = `
        <div class="chat-msg-card">
            <div class="chat-msg-header">
                <span class="chat-msg-author">${authorName}</span>
                <span class="chat-msg-time">${time}</span>
            </div>
            <div class="chat-msg-content">${formatted}</div>
            ${pdfActionHtml}
        </div>
    `;

    chatMessages.appendChild(row);
    chatMessages.scrollTop = chatMessages.scrollHeight;
}

function showTypingIndicator() {
    const row = document.createElement("div");
    row.className = "chat-msg-row assistant";
    row.innerHTML = `
        <div class="chat-msg-card">
            <div class="chat-msg-header">
                <span class="chat-msg-author">SensiMonitor</span>
            </div>
            <div class="typing-dots">
                <span class="typing-dot"></span>
                <span class="typing-dot"></span>
                <span class="typing-dot"></span>
            </div>
        </div>
    `;

    chatMessages.appendChild(row);
    chatMessages.scrollTop = chatMessages.scrollHeight;
    return row;
}

function formatText(text) {
    if (!text) return "";

    let safe = text
        .replace(/&/g, "&amp;")
        .replace(/</g, "&lt;")
        .replace(/>/g, "&gt;");

    // Formatação simples de markdown
    safe = safe.replace(/\*\*(.*?)\*\*/g, "<strong>$1</strong>");
    safe = safe.replace(/### (.*$)/gim, '<div style="font-weight:600; color:#1e60ac; margin:6px 0 2px 0;">$1</div>');
    safe = safe.replace(/## (.*$)/gim, '<div style="font-weight:600; color:#1e60ac; margin:8px 0 2px 0;">$1</div>');
    safe = safe.replace(/```([\s\S]*?)```/g, '<pre><code>$1</code></pre>');
    safe = safe.replace(/`([^`]+)`/g, '<code>$1</code>');
    safe = safe.replace(/\n/g, "<br>");

    return safe;
}
