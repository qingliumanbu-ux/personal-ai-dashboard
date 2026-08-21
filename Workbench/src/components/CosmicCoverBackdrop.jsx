import { useEffect, useRef } from "react";

function seededRandom(seed) {
  let state = seed >>> 0;
  return () => {
    state += 0x6d2b79f5;
    let value = state;
    value = Math.imul(value ^ (value >>> 15), value | 1);
    value ^= value + Math.imul(value ^ (value >>> 7), value | 61);
    return ((value ^ (value >>> 14)) >>> 0) / 4294967296;
  };
}

export function CosmicCoverBackdrop() {
  const canvasRef = useRef(null);

  useEffect(() => {
    const canvas = canvasRef.current;
    const host = canvas?.parentElement;
    const context = canvas?.getContext("2d");
    if (!canvas || !host || !context) return undefined;

    const reducedMotion = window.matchMedia("(prefers-reduced-motion: reduce)");
    let width = 1;
    let height = 1;
    let stars = [];
    let dust = [];
    let frame = 0;
    let lastFrame = 0;
    const pointer = { x: 0.5, y: 0.5 };

    const rebuild = () => {
      const rect = host.getBoundingClientRect();
      width = Math.max(1, rect.width);
      height = Math.max(1, rect.height);
      const ratio = Math.min(window.devicePixelRatio || 1, 1.4);
      canvas.width = Math.floor(width * ratio);
      canvas.height = Math.floor(height * ratio);
      canvas.style.width = `${width}px`;
      canvas.style.height = `${height}px`;
      context.setTransform(ratio, 0, 0, ratio, 0, 0);

      const random = seededRandom(Math.floor(width * 23 + height * 17 + 137));
      stars = Array.from({ length: 320 }, () => ({
        x: random(),
        y: random(),
        r: 0.4 + random() * 1.35,
        a: 0.24 + random() * 0.62,
        p: random() * Math.PI * 2,
        d: random(),
      }));
      dust = Array.from({ length: 860 }, (_, index) => {
        const radius = Math.pow(random(), 0.72);
        const arm = index % 3;
        return {
          radius,
          arm,
          offset: (random() - 0.5) * (0.44 + radius * 0.8),
          sx: (random() - 0.5) * (22 + radius * 140),
          sy: (random() - 0.5) * (10 + radius * 70),
          size: 0.3 + random() * 1.2,
          alpha: 0.05 + random() * 0.21,
          hue: arm === 0 ? 202 + random() * 18 : arm === 1 ? 258 + random() * 28 : 292 + random() * 22,
        };
      });
      draw(0);
    };

    function draw(timestamp) {
      context.clearRect(0, 0, width, height);
      const centerX = width * 0.55;
      const centerY = height * 0.49;
      const maxX = Math.min(width * 0.48, 760);
      const maxY = Math.min(height * 0.11, 130);
      const drift = timestamp * 0.0001;

      dust.forEach((particle) => {
        const theta = particle.radius * Math.PI * 5.6 + particle.arm * ((Math.PI * 2) / 3) + particle.offset + drift;
        const x0 = Math.cos(theta) * particle.radius * maxX + particle.sx;
        const y0 = Math.sin(theta) * particle.radius * maxY + particle.sy;
        const x = centerX + x0 - y0 * 0.25;
        const y = centerY + x0 * 0.05 + y0;
        const coreBoost = Math.max(0, 1 - particle.radius) * 0.22;
        context.beginPath();
        context.fillStyle = `hsla(${particle.hue}, 95%, 79%, ${Math.min(0.42, particle.alpha + coreBoost)})`;
        context.arc(x, y, particle.size, 0, Math.PI * 2);
        context.fill();
      });

      const glow = context.createRadialGradient(centerX, centerY, 0, centerX, centerY, Math.min(width, height) * 0.32);
      glow.addColorStop(0, "rgba(126, 163, 255, 0.4)");
      glow.addColorStop(0.3, "rgba(146, 87, 219, 0.22)");
      glow.addColorStop(0.62, "rgba(67, 97, 166, 0.09)");
      glow.addColorStop(1, "rgba(0, 0, 0, 0)");
      context.fillStyle = glow;
      context.fillRect(0, 0, width, height);

      stars.forEach((star) => {
        const pulse = reducedMotion.matches ? 1 : 0.72 + Math.sin(timestamp * 0.0012 + star.p) * 0.28;
        const px = (pointer.x - 0.5) * star.d * 10;
        const py = (pointer.y - 0.5) * star.d * 6;
        context.beginPath();
        context.fillStyle = `rgba(226, 235, 255, ${star.a * pulse})`;
        if (star.d > 0.86) {
          context.shadowColor = "rgba(157, 188, 255, 0.5)";
          context.shadowBlur = 7;
        }
        context.arc(star.x * width + px, star.y * height + py, star.r, 0, Math.PI * 2);
        context.fill();
        context.shadowBlur = 0;
      });
    }

    const animate = (timestamp) => {
      if (timestamp - lastFrame >= 1000 / 30) {
        lastFrame = timestamp;
        draw(timestamp);
      }
      frame = window.requestAnimationFrame(animate);
    };

    const onPointerMove = (event) => {
      const rect = host.getBoundingClientRect();
      pointer.x = Math.max(0, Math.min(1, (event.clientX - rect.left) / Math.max(rect.width, 1)));
      pointer.y = Math.max(0, Math.min(1, (event.clientY - rect.top) / Math.max(rect.height, 1)));
    };

    const restart = () => {
      if (frame) window.cancelAnimationFrame(frame);
      frame = 0;
      draw(0);
      if (!reducedMotion.matches) frame = window.requestAnimationFrame(animate);
    };

    const resizeObserver = new ResizeObserver(rebuild);
    resizeObserver.observe(host);
    host.addEventListener("pointermove", onPointerMove, { passive: true });
    reducedMotion.addEventListener?.("change", restart);
    rebuild();
    restart();

    return () => {
      resizeObserver.disconnect();
      host.removeEventListener("pointermove", onPointerMove);
      reducedMotion.removeEventListener?.("change", restart);
      if (frame) window.cancelAnimationFrame(frame);
    };
  }, []);

  return <canvas aria-hidden="true" className="formal-cover__canvas" ref={canvasRef} />;
}
