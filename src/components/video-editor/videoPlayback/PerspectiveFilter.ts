import { Filter, GlProgram, GpuProgram } from "pixi.js";

// WebGL (GLSL) Vertex Shader
const vertexSrc = `
in vec2 aPosition;
out vec2 vTextureCoord;

uniform vec4 uInputSize;
uniform vec4 uOutputFrame;
uniform vec4 uOutputTexture;

vec4 filterVertexPosition(void) {
    vec2 position = aPosition * uOutputFrame.zw + uOutputFrame.xy;
    position.x = position.x * (2.0 / uOutputTexture.x) - 1.0;
    position.y = position.y * (2.0 * uOutputTexture.z / uOutputTexture.y) - uOutputTexture.z;
    return vec4(position, 0.0, 1.0);
}

vec2 filterTextureCoord(void) {
    return aPosition * (uOutputFrame.zw * uInputSize.zw);
}

void main(void) {
    gl_Position = filterVertexPosition();
    vTextureCoord = filterTextureCoord();
}
`;

// WebGL (GLSL) Fragment Shader
const fragmentSrc = `
in vec2 vTextureCoord;
out vec4 finalColor;

uniform sampler2D uTexture;
uniform float uRotateX;
uniform float uRotateY;

void main(void) {
    vec2 uv = vTextureCoord - vec2(0.5);
    
    // Apply 3D perspective distortion based on X and Y rotations.
    // 2.2 is a perspective strength factor.
    float z = uv.x * sin(uRotateY) + uv.y * sin(uRotateX);
    vec2 tiltedUv = uv / (1.0 + z * 2.2);
    tiltedUv += vec2(0.5);
    
    if (tiltedUv.x < 0.0 || tiltedUv.x > 1.0 || tiltedUv.y < 0.0 || tiltedUv.y > 1.0) {
        finalColor = vec4(0.0, 0.0, 0.0, 0.0);
    } else {
        finalColor = texture(uTexture, tiltedUv);
    }
}
`;

// WebGPU (WGSL) Shaders
const wgslVertexSrc = `
struct VSOutput {
    @builtin(position) position: vec4<f32>,
    @location(0) uv: vec2<f32>,
};

struct GlobalFilterUniforms {
    uInputSize: vec4<f32>,
    uOutputFrame: vec4<f32>,
    uOutputTexture: vec4<f32>,
};

@group(0) @binding(0) var<uniform> globalFilterUniforms: GlobalFilterUniforms;

@vertex
fn mainVertex(@location(0) position: vec2<f32>) -> VSOutput {
    var out: VSOutput;
    
    var pos = position * globalFilterUniforms.uOutputFrame.zw + globalFilterUniforms.uOutputFrame.xy;
    pos.x = pos.x * (2.0 / globalFilterUniforms.uOutputTexture.x) - 1.0;
    pos.y = pos.y * (2.0 * globalFilterUniforms.uOutputTexture.z / globalFilterUniforms.uOutputTexture.y) - globalFilterUniforms.uOutputTexture.z;
    
    out.position = vec4<f32>(pos, 0.0, 1.0);
    out.uv = position * (globalFilterUniforms.uOutputFrame.zw * globalFilterUniforms.uInputSize.zw);
    return out;
}
`;

const wgslFragmentSrc = `
@group(0) @binding(1) var uTexture: texture_2d<f32>;
@group(0) @binding(2) var uSampler: sampler;

struct PerspectiveUniforms {
    uRotateX: f32,
    uRotateY: f32,
};

@group(1) @binding(0) var<uniform> perspectiveUniforms: PerspectiveUniforms;

@fragment
fn mainFragment(@location(0) uv: vec2<f32>) -> @location(0) vec4<f32> {
    var centeredUv = uv - vec2<f32>(0.5, 0.5);
    var z = centeredUv.x * sin(perspectiveUniforms.uRotateY) + centeredUv.y * sin(perspectiveUniforms.uRotateX);
    var tiltedUv = centeredUv / (1.0 + z * 2.2) + vec2<f32>(0.5, 0.5);
    
    if (tiltedUv.x < 0.0 || tiltedUv.x > 1.0 || tiltedUv.y < 0.0 || tiltedUv.y > 1.0) {
        return vec4<f32>(0.0, 0.0, 0.0, 0.0);
    }
    return textureSample(uTexture, uSampler, tiltedUv);
}
`;

export class PerspectiveFilter extends Filter {
    private perspectiveUniforms: any;

    constructor() {
        let gpuProgram: GpuProgram | undefined;
        let glProgram: GlProgram | undefined;

        try {
            gpuProgram = GpuProgram.from({
                vertex: {
                    source: wgslVertexSrc,
                    entryPoint: "mainVertex",
                },
                fragment: {
                    source: wgslFragmentSrc,
                    entryPoint: "mainFragment",
                },
            });
        } catch (e) {
            console.warn("Failed to compile WGSL GpuProgram for PerspectiveFilter:", e);
        }

        try {
            glProgram = GlProgram.from({
                vertex: vertexSrc,
                fragment: fragmentSrc,
                name: "perspective-tilt-filter",
            });
        } catch (e) {
            console.warn("Failed to compile GLSL GlProgram for PerspectiveFilter:", e);
        }

        super({
            gpuProgram,
            glProgram,
            resources: {
                perspectiveUniforms: {
                    uRotateX: { value: 0, type: "f32" },
                    uRotateY: { value: 0, type: "f32" },
                },
            },
        });

        // Cache reference to uniforms
        this.perspectiveUniforms = this.resources.perspectiveUniforms.uniforms;
    }

    /**
     * Updates the tilt values based on focus point and progress.
     * @param focus - Focus coordinate (cx, cy) ranging from 0 to 1
     * @param progress - Animation progress from 0 to 1
     * @param angleDegrees - Maximum tilt angle in degrees
     */
    public update(
        focus: { cx: number; cy: number } | null,
        progress: number,
        angleDegrees = 12
    ): void {
        if (!focus) {
            this.perspectiveUniforms.uRotateX = 0;
            this.perspectiveUniforms.uRotateY = 0;
            return;
        }

        // Calculate direction relative to center (0.5, 0.5)
        const dx = focus.cx - 0.5;
        const dy = focus.cy - 0.5;

        // Convert angle to radians
        const maxAngleRad = (angleDegrees * Math.PI) / 180;

        // Tilt direction:
        // - Rotate Y (yaw) tilts around vertical axis (focus on left tilts left closer)
        // - Rotate X (pitch) tilts around horizontal axis (focus on top tilts top closer)
        // Multiply by 2.0 to scale focus offset [-0.5, 0.5] to full range [-1.0, 1.0]
        const targetRotateY = dx * 2.0 * maxAngleRad;
        const targetRotateX = dy * 2.0 * maxAngleRad;

        // Apply progress interpolation
        this.perspectiveUniforms.uRotateY = targetRotateY * progress;
        this.perspectiveUniforms.uRotateX = targetRotateX * progress;
    }
}
