// ══════════════════════════════════════════════════════════
//  SHADERS.JS — Post-processing : ColorGrade + Vignette
// ══════════════════════════════════════════════════════════

export const ColorGradeShader = {
    name: 'ColorGradeShader',
    uniforms: {
        tDiffuse:    { value: null },
        uDarkness:   { value: 0.0 },   // 0–1, assombrit (Entrailles)
        uContrast:   { value: 1.08 },
        uSaturation: { value: 0.88 },
        uVigStrength:{ value: 0.55 },
    },
    vertexShader: /* glsl */`
        varying vec2 vUv;
        void main() {
            vUv = uv;
            gl_Position = projectionMatrix * modelViewMatrix * vec4(position,1.0);
        }
    `,
    fragmentShader: /* glsl */`
        uniform sampler2D tDiffuse;
        uniform float uDarkness;
        uniform float uContrast;
        uniform float uSaturation;
        uniform float uVigStrength;
        varying vec2 vUv;

        vec3 adjustContrast(vec3 c, float f) {
            return (c - 0.5) * f + 0.5;
        }
        vec3 adjustSaturation(vec3 c, float f) {
            float lum = dot(c, vec3(0.2126,0.7152,0.0722));
            return mix(vec3(lum), c, f);
        }

        void main() {
            vec4 tex = texture2D(tDiffuse, vUv);
            vec3 col = tex.rgb;

            // Contraste et saturation
            col = adjustContrast(col, uContrast);
            col = adjustSaturation(col, uSaturation);

            // Légère teinte froide dark fantasy
            col.b += 0.012;
            col.r -= 0.008;

            // Assombrissement progressif (Entrailles)
            col = mix(col, vec3(0.0), uDarkness);

            // Vignette
            vec2 uv2 = vUv * (1.0 - vUv.yx);
            float vig = pow(uv2.x * uv2.y * 16.0, uVigStrength);
            col *= vig;

            gl_FragColor = vec4(clamp(col, 0.0, 1.0), tex.a);
        }
    `,
};
