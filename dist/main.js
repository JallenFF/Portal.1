const canvas = document.getElementById('canvas');
const ctx = canvas.getContext('2d');
function resize() {
  canvas.width = window.innerWidth;
  canvas.height = window.innerHeight;
}
resize();
window.addEventListener('resize', resize);
ctx.fillStyle = '#0A0A0C';
ctx.fillRect(0, 0, canvas.width, canvas.height);
ctx.beginPath();
ctx.arc(canvas.width / 2, canvas.height / 2, 60, 0, Math.PI * 2);
ctx.fillStyle = '#F59E0B22';
ctx.fill();
ctx.strokeStyle = '#F59E0B55';
ctx.lineWidth = 1.5;
ctx.stroke();
ctx.fillStyle = 'rgba(255,255,255,0.6)';
ctx.font = '14px system-ui';
ctx.textAlign = 'center';
ctx.fillText('Portal v0.2.0', canvas.width / 2, canvas.height / 2 + 4);
ctx.fillStyle = 'rgba(255,255,255,0.15)';
ctx.font = '10px system-ui';
ctx.fillText('Tauri shell running', canvas.width / 2, canvas.height / 2 + 22);