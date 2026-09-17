// AquaSentinel — homepage behaviour: nav-on-scroll, scroll-reveal, the hero
// glowing-globe scene, the Expertise section's droplet scene, and the
// compliance carousel.

// ---- Nav background on scroll ----
(function () {
    const navBar = document.getElementById('nav-bar');
    if (!navBar) return;
    function onScrollNav() {
        if (window.scrollY > 40) navBar.classList.add('nav-scrolled');
        else navBar.classList.remove('nav-scrolled');
    }
    window.addEventListener('scroll', onScrollNav, { passive: true });
    onScrollNav();
})();

// ---- Reveal-on-scroll for cards ----
(function () {
    const revealEls = document.querySelectorAll('.reveal');
    if (!revealEls.length) return;
    if ('IntersectionObserver' in window) {
        const io = new IntersectionObserver((entries) => {
            entries.forEach((entry) => {
                if (entry.isIntersecting) {
                    entry.target.classList.add('revealed');
                    io.unobserve(entry.target);
                }
            });
        }, { threshold: 0.15 });
        revealEls.forEach((el) => io.observe(el));
    } else {
        revealEls.forEach((el) => el.classList.add('revealed'));
    }
})();

// ---- Shared: raindrop profile revolved into a Lathe geometry ----
function aquaDropletGeometry(scale) {
    const pts = [
        [0.000, 1.35], [0.040, 1.18], [0.100, 1.00], [0.190, 0.80],
        [0.300, 0.58], [0.420, 0.34], [0.530, 0.10], [0.620, -0.16],
        [0.680, -0.40], [0.700, -0.62], [0.680, -0.82], [0.610, -0.99],
        [0.490, -1.11], [0.330, -1.19], [0.150, -1.23], [0.000, -1.24],
    ].map(([x, y]) => new THREE.Vector2(x * scale, y * scale));
    return new THREE.LatheGeometry(pts, 64);
}

// ---- Hero: glowing data globe ----
(function () {
    const canvas = document.getElementById('hero-canvas');
    if (!canvas || typeof THREE === 'undefined') return;

    const scene = new THREE.Scene();
    const camera = new THREE.PerspectiveCamera(45, canvas.clientWidth / canvas.clientHeight, 0.1, 100);
    camera.position.set(0, 0, 7);

    const renderer = new THREE.WebGLRenderer({ canvas, antialias: true, alpha: true });
    renderer.setPixelRatio(Math.min(window.devicePixelRatio || 1, 2));
    renderer.setSize(canvas.clientWidth, canvas.clientHeight, false);

    scene.add(new THREE.AmbientLight(0x1c2b45, 1.0));
    const key = new THREE.DirectionalLight(0xbfe6ff, 1.4);
    key.position.set(4, 3, 5);
    scene.add(key);
    const rim = new THREE.PointLight(0x38bdf8, 3.5, 30);
    rim.position.set(-4, 2, 3);
    scene.add(rim);

    const group = new THREE.Group();

    const sphere = new THREE.Mesh(
        new THREE.SphereGeometry(1.7, 64, 64),
        new THREE.MeshStandardMaterial({ color: 0x0b3a6b, roughness: 0.55, metalness: 0.2, emissive: 0x08213f, emissiveIntensity: 0.6 })
    );
    group.add(sphere);

    const wire = new THREE.Mesh(
        new THREE.SphereGeometry(1.73, 24, 16),
        new THREE.MeshBasicMaterial({ color: 0x38bdf8, wireframe: true, transparent: true, opacity: 0.18 })
    );
    group.add(wire);

    // Fresnel-glow atmosphere shell
    const atmo = new THREE.Mesh(
        new THREE.SphereGeometry(1.95, 64, 64),
        new THREE.ShaderMaterial({
            uniforms: { glowColor: { value: new THREE.Color(0x38bdf8) } },
            vertexShader: `
                varying float vFresnel;
                void main() {
                    vec3 viewDir = normalize(-(modelViewMatrix * vec4(position, 1.0)).xyz);
                    vec3 n = normalize(normalMatrix * normal);
                    vFresnel = pow(1.0 - max(dot(n, viewDir), 0.0), 2.6);
                    gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0);
                }
            `,
            fragmentShader: `
                varying float vFresnel;
                uniform vec3 glowColor;
                void main() { gl_FragColor = vec4(glowColor, vFresnel * 0.9); }
            `,
            transparent: true,
            blending: THREE.AdditiveBlending,
            depthWrite: false,
        })
    );
    group.add(atmo);

    // Sensor "data points" scattered on the globe surface (fibonacci sphere)
    const dotCount = 10;
    for (let i = 0; i < dotCount; i++) {
        const phi = Math.acos(1 - 2 * (i + 0.5) / dotCount);
        const theta = Math.PI * (1 + Math.sqrt(5)) * i;
        const r = 1.76;
        const dot = new THREE.Mesh(
            new THREE.SphereGeometry(0.033, 8, 8),
            new THREE.MeshBasicMaterial({ color: 0x7dd3fc })
        );
        dot.position.set(r * Math.sin(phi) * Math.cos(theta), r * Math.sin(phi) * Math.sin(theta), r * Math.cos(phi));
        group.add(dot);
    }

    scene.add(group);

    const particleCount = 140;
    const positions = new Float32Array(particleCount * 3);
    for (let i = 0; i < particleCount; i++) {
        positions[i * 3] = (Math.random() - 0.5) * 16;
        positions[i * 3 + 1] = (Math.random() - 0.5) * 10;
        positions[i * 3 + 2] = (Math.random() - 0.5) * 6;
    }
    const pGeo = new THREE.BufferGeometry();
    pGeo.setAttribute('position', new THREE.BufferAttribute(positions, 3));
    scene.add(new THREE.Points(pGeo, new THREE.PointsMaterial({ color: 0x7dd3fc, size: 0.022, transparent: true, opacity: 0.5 })));

    let mouseX = 0, mouseY = 0;
    window.addEventListener('mousemove', (e) => {
        mouseX = (e.clientX / window.innerWidth) - 0.5;
        mouseY = (e.clientY / window.innerHeight) - 0.5;
    });

    const clock = new THREE.Clock();
    function animate() {
        requestAnimationFrame(animate);
        const t = clock.getElapsedTime();
        group.rotation.y = t * 0.15 + mouseX * 0.3;
        group.rotation.x = mouseY * -0.15;
        wire.rotation.y = -t * 0.05;
        renderer.render(scene, camera);
    }
    animate();

    window.addEventListener('resize', () => {
        const w = canvas.clientWidth, h = canvas.clientHeight;
        camera.aspect = w / h;
        camera.updateProjectionMatrix();
        renderer.setSize(w, h, false);
    });
})();

// ---- Expertise section: centered droplet ----
(function () {
    const canvas = document.getElementById('expertise-canvas');
    if (!canvas || typeof THREE === 'undefined') return;

    const scene = new THREE.Scene();
    const camera = new THREE.PerspectiveCamera(45, canvas.clientWidth / canvas.clientHeight, 0.1, 100);
    camera.position.set(0, 0.1, 6.5);

    const renderer = new THREE.WebGLRenderer({ canvas, antialias: true, alpha: true });
    renderer.setPixelRatio(Math.min(window.devicePixelRatio || 1, 2));
    renderer.setSize(canvas.clientWidth, canvas.clientHeight, false);

    scene.add(new THREE.AmbientLight(0x22406a, 1.1));
    const key = new THREE.DirectionalLight(0xdff3ff, 1.5);
    key.position.set(3, 5, 5);
    scene.add(key);
    const rim = new THREE.PointLight(0x38bdf8, 4, 26);
    rim.position.set(-4, 1, 4);
    scene.add(rim);
    const back = new THREE.PointLight(0xffffff, 1.8, 18);
    back.position.set(0, 2, -5);
    scene.add(back);

    const geo = aquaDropletGeometry(2.1);
    geo.computeVertexNormals();
    const drop = new THREE.Mesh(geo, new THREE.MeshPhysicalMaterial({
        color: 0x1c8fd6, roughness: 0.12, metalness: 0.0, transmission: 0.55, clearcoat: 1.0, clearcoatRoughness: 0.08,
    }));
    scene.add(drop);

    const ring = new THREE.Mesh(
        new THREE.RingGeometry(2.5, 2.6, 64),
        new THREE.MeshBasicMaterial({ color: 0x38bdf8, transparent: true, opacity: 0.2, side: THREE.DoubleSide })
    );
    ring.rotation.x = -Math.PI / 2 + 0.15;
    ring.position.y = -2.25;
    scene.add(ring);

    let mouseX = 0;
    window.addEventListener('mousemove', (e) => { mouseX = (e.clientX / window.innerWidth) - 0.5; });

    const clock = new THREE.Clock();
    function animate() {
        requestAnimationFrame(animate);
        const t = clock.getElapsedTime();
        drop.rotation.y = t * 0.12 + mouseX * 0.3;
        drop.position.y = Math.sin(t * 0.4) * 0.12;
        ring.scale.setScalar(1 + Math.sin(t * 0.8) * 0.04);
        renderer.render(scene, camera);
    }
    animate();

    window.addEventListener('resize', () => {
        const w = canvas.clientWidth, h = canvas.clientHeight;
        camera.aspect = w / h;
        camera.updateProjectionMatrix();
        renderer.setSize(w, h, false);
    });
})();

// ---- Compliance carousel ----
(function () {
    const track = document.getElementById('carousel-track');
    if (!track) return;
    const slides = track.children.length;
    let index = 0;
    const prevBtn = document.getElementById('carousel-prev');
    const nextBtn = document.getElementById('carousel-next');
    const dotsWrap = document.getElementById('carousel-dots');

    if (dotsWrap) {
        dotsWrap.innerHTML = Array.from({ length: slides }).map((_, i) =>
            `<button class="carousel-dot ${i === 0 ? 'active' : ''}" data-i="${i}"></button>`
        ).join('');
    }

    function update() {
        track.style.transform = `translateX(-${index * 100}%)`;
        if (dotsWrap) {
            dotsWrap.querySelectorAll('.carousel-dot').forEach((d, i) => d.classList.toggle('active', i === index));
        }
    }
    function go(delta) {
        index = (index + delta + slides) % slides;
        update();
    }
    if (prevBtn) prevBtn.addEventListener('click', () => go(-1));
    if (nextBtn) nextBtn.addEventListener('click', () => go(1));
    if (dotsWrap) dotsWrap.addEventListener('click', (e) => {
        const btn = e.target.closest('.carousel-dot');
        if (btn) { index = parseInt(btn.dataset.i, 10); update(); }
    });

    let auto = setInterval(() => go(1), 6000);
    track.closest('.carousel-wrap')?.addEventListener('mouseenter', () => clearInterval(auto));
})();
