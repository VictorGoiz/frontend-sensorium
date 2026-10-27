/**
 * ============================================================================
 * SENSIMONITOR - DADOS SIMULADOS E LIMITES PADRÃO LFG60 (MOCK)
 * ============================================================================
 */
(function (global) {
    'use strict';

    const DEFAULT_LFG60_LIMITES = {
        temperatura: { min_ideal: 18.0, max_ideal: 26.0, crit_min: 15.0, crit_max: 30.0, unit: '°C', label: 'Temperatura' },
        umidade: { min_ideal: 30.0, max_ideal: 60.0, crit_min: 20.0, crit_max: 75.0, unit: '%', label: 'Umidade' },
        co2: { max_ideal: 800.0, max_aviso: 1000.0, unit: 'ppm', label: 'Dióxido de Carbono (CO2)' },
        pm25: { max_ideal: 15.0, max_aviso: 25.0, unit: 'µg/m³', label: 'Partículas Finas (PM2.5)' },
        pm10: { max_ideal: 30.0, max_aviso: 50.0, unit: 'µg/m³', label: 'Partículas Grossas (PM10)' },
        voc: { max_ideal: 0.20, max_aviso: 0.30, unit: 'ppm', label: 'Compostos Orgânicos Voláteis (VOC)' },
        formaldeido: { max_ideal: 0.05, max_aviso: 0.10, unit: 'mg/m³', label: 'Formaldeído (HCHO)' }
    };

    const SIMULATED_LFG60_DEVICES = [
        {
            numero_serie: 'LFG60-SIM-01',
            nome: 'Meeting Room - Floor 2',
            cliente: 'LEFOO Innovation Lab',
            status: 'Operational',
            led: 'Green',
            isSimulated: true,
            _simTemp: 23.0,
            _simInc: 0.5,
            ultima_leitura: {
                temperatura: 23.0,
                umidade: 55.0,
                co2: 450,
                pm25: 10.2,
                pm10: 18.0,
                voc: 0.15,
                formaldeido: 0.02,
                timestamp: new Date().toISOString()
            }
        },
        {
            numero_serie: 'LFG60-SIM-02',
            nome: 'Cleanroom Lab - Zone B',
            cliente: 'LEFOO Innovation Lab',
            status: 'Operational',
            led: 'Green',
            isSimulated: true,
            _simTemp: 28.0,
            _simInc: 0.5,
            ultima_leitura: {
                temperatura: 28.0,
                umidade: 55.0,
                co2: 450,
                pm25: 10.2,
                pm10: 18.0,
                voc: 0.15,
                formaldeido: 0.02,
                timestamp: new Date().toISOString()
            }
        }
    ];

    const SIMULATED_COWORKING_DEVICES = [
        {
            numero_serie: 'LFG60-CW-01',
            nome: 'Espaço Coworking - 3º Andar (Principal)',
            cliente: 'Coworking Corporativo',
            status: 'Operational',
            led: 'Green',
            isSimulated: true,
            ultima_leitura: {
                temperatura: 22.8,
                umidade: 52.0,
                co2: 520,
                pm25: 8.4,
                pm10: 15.2,
                voc: 0.11,
                formaldeido: 0.015,
                timestamp: new Date().toISOString()
            }
        }
    ];

    global.DEFAULT_LFG60_LIMITES = DEFAULT_LFG60_LIMITES;
    global.SIMULATED_LFG60_DEVICES = SIMULATED_LFG60_DEVICES;
    global.SIMULATED_COWORKING_DEVICES = SIMULATED_COWORKING_DEVICES;
})(window);
