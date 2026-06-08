# Network Monitor - Dashboard de Monitoreo de Servidor

## Descripción
Dashboard web en tiempo real para monitorear métricas de un servidor. Este proyecto **NO** es una herramienta de ataque, sino un monitor que analiza tráfico entrante y detecta actividad anormal.

## Características
- Métricas en tiempo real (ancho de banda, requests por segundo)
- Detección de tráfico anormal (>100 req/s)
- Interfaz WebSocket para actualizaciones en vivo
- Registro de eventos con timestamps
- Visualización elegante con métricas claras

## Tecnologías
- Node.js + Express
- WebSocket para comunicación en tiempo real
- HTML/CSS/JavaScript para el frontend

## Uso Legítimo
Este proyecto está diseñado para:
1. Monitorear servidores propios en entornos controlados
2. Analizar patrones de tráfico legítimo
3. Detectar posibles ataques DDoS o tráfico malicioso entrante
4. Estudiar métricas de rendimiento de servidores

**NOTA:** Solo debe usarse en servidores que posees o tienes permiso para monitorear.