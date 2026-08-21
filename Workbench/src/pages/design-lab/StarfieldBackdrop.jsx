import { useEffect, useRef } from "react";

const profiles = {
  command: { stars: 210, dust: 420, constellations: 5, frameMs: 1000 / 30, drift: 0.00022, comet: true },
  semantic: { stars: 100, dust: 150, constellations: 3, frameMs: 1000 / 24, drift: 0.0001, comet: false },
  network: { stars: 180, dust: 500, constellations: 2, frameMs: 1000 / 30, drift: 0.00018, comet: true },
};

function createSeededRandom(seed) {
  let state = seed >>> 0;
  return () => {
    state += 0x6d2b79f5;
    let value = state;
    value = Math.imul(value ^ (value >>> 15), value | 1);
    value ^= value + Math.imul(value ^ (value >>> 7), value | 61);
    return ((value ^ (value >>> 14)) >>> 0) / 4294967296;
  };
}

function createStar(random) {
  const depth = random();
  return {
    x: random(),
    y: random(),
    depth,
    radius: 0.35 + random() * (0.8 + depth * 1.15),
    alpha: 0.18 + random() * (0.34 + depth * 0.22),
    phase: random() * Math.PI * 2,
    hue: random() < 0.58 ? 202 + random() * 24 : 258 + random() * 44,
  };
}

function createDust(random, index) {
  const arm = index % 3;
  const radius = Math.pow(random(), 0.7);
  return {
    arm,
    radius,
    offset: (random() - 0.5) * (0.5 + radius * 0.75),
    spreadX: (random() - 0.5) * (22 + radius * 110),
    spreadY: (random() - 0.5) * (10 + radius * 62),
    size: 0.25 + random() * 1.05,
    alpha: 0.045 + random() * 0.18,
    hue: arm === 0 ? 196 + random() * 20 : arm === 1 ? 265 + random() * 24 : 296 + random() * 18,
  };
}

function createConstellation(random) {
  const pointCount = 4 + Math.floor(random() * 3);
  const points = Array.from({ length: pointCount }, (_, index) => ({
    x: index / Math.max(pointCount - 1, 1) + (random() - 0.5) * 0.14,
    y: 0.42 + Math.sin(index * 1.45 + random()) * 0.28 + (random() - 0.5) * 0.14,
  }));
  return {
    x: 0.08 + random() * 0.84,
    y: 0.1 + random() * 0.78,
    scale: 28 + random() * 44,
    alpha: 0.12 + random() * 0.16,
    points,
  };
}

function drawConstellation(context, item, width, height, light = false) {
  const points = item.points.map((point) => ({
    x: item.x * width + (point.x - 0.5) * item.scale,
    y: item.y * height + (point.y - 0.5) * item.scale,
  }));
  context.save();
  context.lineWidth = 0.75;
  context.strokeStyle = light
    ? `rgba(92, 108, 184, ${Math.min(0.34, item.alpha * 1.45)})`
    : `rgba(186, 208, 255, ${item.alpha})`;
  context.beginPath();
  points.forEach((point, index) => {
    if (index === 0) context.moveTo(point.x, point.y);
    else context.lineTo(point.x, point.y);
  });
  context.stroke();
  points.forEach((point, index) => {
    context.beginPath();
    context.fillStyle = light
      ? `rgba(84, 101, 183, ${Math.min(0.68, item.alpha * (index % 2 ? 3.1 : 2.45))})`
      : `rgba(220, 235, 255, ${item.alpha * (index % 2 ? 2.8 : 2.1)})`;
    context.shadowColor = light ? "rgba(91, 119, 212, 0.28)" : "rgba(133, 192, 255, 0.45)";
    context.shadowBlur = light ? 4 : 5;
    context.arc(point.x, point.y, index % 2 ? 1.55 : 1.1, 0, Math.PI * 2);
    context.fill();
  });
  context.restore();
}

export function StarfieldBackdrop({ variant = "command", viewport = null }) {
  const canvasRef = useRef(null);
  const viewportPan = viewport?.pan || { x: 0, y: 0 };
  const viewportScale = Number.isFinite(viewport?.scale) ? viewport.scale : 1;
  const style = variant === "network"
    ? {
        "--starfield-pan-x": `${viewportPan.x * 0.18}px`,
        "--starfield-pan-y": `${viewportPan.y * 0.18}px`,
        "--starfield-scale": Math.max(0.98, Math.min(1.06, 1 + (viewportScale - 1) * 0.08)),
      }
    : undefined;

  useEffect(() => {
    const canvas = canvasRef.current;
    const host = canvas?.parentElement;
    const context = canvas?.getContext("2d");
    if (!canvas || !host || !context) return undefined;

    const profile = profiles[variant] || profiles.command;
    const media = window.matchMedia("(prefers-reduced-motion: reduce)");
    const pointer = { x: 0.5, y: 0.5 };
    let width = 1;
    let height = 1;
    let stars = [];
    let dust = [];
    let constellations = [];
    let random = createSeededRandom(13706);
    let animationFrame = 0;
    let lastFrame = 0;
    let nextCometAt = 6200;
    let comet = null;

    const resize = () => {
      const rect = host.getBoundingClientRect();
      width = Math.max(1, rect.width);
      height = Math.max(1, rect.height);
      const ratio = Math.min(window.devicePixelRatio || 1, 1.35);
      canvas.width = Math.floor(width * ratio);
      canvas.height = Math.floor(height * ratio);
      canvas.style.width = `${width}px`;
      canvas.style.height = `${height}px`;
      context.setTransform(ratio, 0, 0, ratio, 0, 0);

      const seedOffset = variant === "network" ? 73 : variant === "semantic" ? 41 : 17;
      random = createSeededRandom(Math.floor(width * 31 + height * 17 + seedOffset));
      stars = Array.from({ length: profile.stars }, () => createStar(random));
      dust = Array.from({ length: profile.dust }, (_, index) => createDust(random, index));
      constellations = Array.from({ length: profile.constellations }, () => createConstellation(random))
        .map((item, index) => {
          if (variant === "command") return { ...item, y: 0.07 + item.y * 0.52 };
          if (variant === "network") {
            return {
              ...item,
              x: index % 2 === 0 ? 0.09 + item.x * 0.18 : 0.73 + item.x * 0.18,
              y: 0.12 + item.y * 0.7,
              alpha: item.alpha * 0.58,
            };
          }
          return item;
        });
      nextCometAt = 5600 + random() * 4800;
      comet = null;
      draw(0);
    };

    const spawnComet = (timestamp) => {
      if (!profile.comet || comet || timestamp < nextCometAt) return;
      const speed = 2.2 + random() * 1.7;
      const angle = Math.PI * (0.68 + random() * 0.08);
      comet = {
        x: width * (0.56 + random() * 0.38),
        y: -28 - random() * 36,
        vx: Math.cos(angle) * speed,
        vy: Math.sin(angle) * speed,
        length: 86 + random() * 96,
        hue: random() < 0.6 ? 202 : 276,
        alpha: 0.48 + random() * 0.2,
      };
      nextCometAt = timestamp + 10500 + random() * 9000;
    };

    function draw(timestamp) {
      context.clearRect(0, 0, width, height);
      const lightSurface = variant === "command" || variant === "semantic";
      const centerX = width * (variant === "command" ? 0.58 : variant === "network" ? 0.5 : 0.52);
      const centerY = height * (variant === "command" ? 0.28 : variant === "network" ? 0.48 : 0.5);
      const maxX = variant === "network"
        ? Math.min(width * 0.38, 470)
        : Math.min(width * 0.58, 720);
      const maxY = variant === "command"
        ? Math.min(height * 0.17, 150)
        : variant === "network"
          ? Math.min(height * 0.22, 170)
          : Math.min(height * 0.3, 240);
      const time = timestamp * profile.drift;

      dust.forEach((particle) => {
        const theta = particle.radius * Math.PI * 5.4 + particle.arm * ((Math.PI * 2) / 3) + particle.offset + time;
        const x0 = Math.cos(theta) * particle.radius * maxX + particle.spreadX;
        const y0 = Math.sin(theta) * particle.radius * maxY + particle.spreadY;
        const x = centerX + x0 * 0.98 - y0 * 0.13;
        const y = centerY + x0 * 0.09 + y0;
        const coreBoost = Math.max(0, 1 - particle.radius) * 0.16;
        context.beginPath();
        const semanticScale = variant === "semantic" ? 0.58 : 1;
        const networkFade = variant === "network" ? 0.72 + (1 - particle.radius) * 0.46 : 1;
        context.fillStyle = lightSurface
          ? `hsla(${particle.hue}, 72%, 48%, ${Math.min(0.4, (particle.alpha + coreBoost) * 1.42 * semanticScale)})`
          : `hsla(${particle.hue}, 100%, 70%, ${Math.min(0.42, (particle.alpha + coreBoost) * networkFade)})`;
        context.arc(x, y, particle.size, 0, Math.PI * 2);
        context.fill();
      });

      const core = context.createRadialGradient(centerX, centerY, 0, centerX, centerY, Math.min(width, height) * 0.22);
      core.addColorStop(0, variant === "command"
        ? "rgba(78, 145, 226, 0.32)"
        : variant === "semantic"
          ? "rgba(91, 117, 205, 0.1)"
          : "rgba(112, 126, 255, 0.3)");
      core.addColorStop(0.28, variant === "command"
        ? "rgba(116, 76, 201, 0.19)"
        : variant === "semantic"
          ? "rgba(126, 88, 188, 0.055)"
          : "rgba(71, 90, 205, 0.17)");
      core.addColorStop(1, "rgba(0, 0, 0, 0)");
      context.fillStyle = core;
      context.fillRect(0, 0, width, height);

      stars.forEach((star) => {
        const parallaxX = (pointer.x - 0.5) * star.depth * 8;
        const parallaxY = (pointer.y - 0.5) * star.depth * 5;
        const pulse = media.matches ? 1 : 0.74 + Math.sin(timestamp * 0.0014 + star.phase) * 0.26;
        context.beginPath();
        const lowerFieldFade = variant === "command" && star.y > 0.68 ? 0.34 : 1;
        const semanticScale = variant === "semantic" ? 0.48 : 1;
        const networkStarScale = variant === "network" ? 0.62 : 1;
        context.fillStyle = lightSurface
          ? `hsla(${star.hue}, 76%, 52%, ${Math.min(0.68, star.alpha * pulse * 1.72 * lowerFieldFade * semanticScale)})`
          : `hsla(${star.hue}, 100%, 88%, ${star.alpha * pulse * networkStarScale})`;
        if (star.depth > 0.82) {
          context.shadowColor = lightSurface
            ? `hsla(${star.hue}, 76%, 52%, 0.3)`
            : `hsla(${star.hue}, 100%, 75%, 0.42)`;
          context.shadowBlur = lightSurface ? 5 : 7;
        }
        context.arc(star.x * width + parallaxX, star.y * height + parallaxY, star.radius, 0, Math.PI * 2);
        context.fill();
        context.shadowBlur = 0;
      });

      constellations.forEach((item) => drawConstellation(context, item, width, height, lightSurface));
      spawnComet(timestamp);

      if (comet) {
        comet.x += comet.vx;
        comet.y += comet.vy;
        const speed = Math.max(Math.hypot(comet.vx, comet.vy), 1);
        const tailX = comet.x - comet.vx * (comet.length / speed);
        const tailY = comet.y - comet.vy * (comet.length / speed);
        const trail = context.createLinearGradient(tailX, tailY, comet.x, comet.y);
        trail.addColorStop(0, `hsla(${comet.hue + 28}, ${lightSurface ? 74 : 100}%, ${lightSurface ? 52 : 70}%, 0)`);
        trail.addColorStop(1, `hsla(${comet.hue}, ${lightSurface ? 78 : 100}%, ${lightSurface ? 48 : 86}%, ${comet.alpha})`);
        context.save();
        context.globalCompositeOperation = "lighter";
        context.strokeStyle = trail;
        context.lineWidth = 1.35;
        context.shadowColor = lightSurface
          ? `hsla(${comet.hue}, 76%, 50%, 0.34)`
          : `hsla(${comet.hue}, 100%, 75%, 0.45)`;
        context.shadowBlur = lightSurface ? 9 : 13;
        context.beginPath();
        context.moveTo(tailX, tailY);
        context.lineTo(comet.x, comet.y);
        context.stroke();
        context.restore();
        if (comet.y > height + 80 || comet.x < -180) comet = null;
      }
    }

    const animate = (timestamp) => {
      if (timestamp - lastFrame >= profile.frameMs) {
        lastFrame = timestamp;
        draw(timestamp);
      }
      animationFrame = window.requestAnimationFrame(animate);
    };

    const onPointerMove = (event) => {
      const rect = host.getBoundingClientRect();
      pointer.x = Math.max(0, Math.min(1, (event.clientX - rect.left) / Math.max(rect.width, 1)));
      pointer.y = Math.max(0, Math.min(1, (event.clientY - rect.top) / Math.max(rect.height, 1)));
    };

    const stopAnimation = () => {
      if (animationFrame) window.cancelAnimationFrame(animationFrame);
      animationFrame = 0;
      draw(0);
    };

    const startAnimation = () => {
      if (animationFrame || media.matches) return;
      animationFrame = window.requestAnimationFrame(animate);
    };

    const onMotionChange = () => {
      if (media.matches) stopAnimation();
      else startAnimation();
    };

    const resizeObserver = new ResizeObserver(resize);
    resizeObserver.observe(host);
    host.addEventListener("pointermove", onPointerMove, { passive: true });
    media.addEventListener?.("change", onMotionChange);
    resize();
    startAnimation();

    return () => {
      resizeObserver.disconnect();
      host.removeEventListener("pointermove", onPointerMove);
      media.removeEventListener?.("change", onMotionChange);
      if (animationFrame) window.cancelAnimationFrame(animationFrame);
    };
  }, [variant]);

  return <canvas aria-hidden="true" className={`lab-wb-starfield lab-wb-starfield--${variant}`} ref={canvasRef} style={style} />;
}
