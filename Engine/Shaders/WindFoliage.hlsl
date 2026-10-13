// WindFoliage.hlsl — GPU twin of Engine/World/WindManager.h
// Constants MUST match WindParams or foliage disagrees with physics/audio.
// Included by all vegetation + cloth vertex shaders; imposters sample once
// per instance on CPU and pass the result as instance data.
Texture3D<float3> g_WindVolume : register(t0); // xy = vel XZ, z = gust 0..1
SamplerState g_LinearClamp : register(s0);

cbuffer WindCB : register(b10)
{
    float g_Time;
    float g_WorldSize;
    float g_HeightScale;
    float g_Pad;
};

// Full procedural displacement: trunk sway (quadratic w/ height) + flutter.
float3 ApplyWindDisplace(float3 worldPos, float3 normal,
                         float height01, float phase, float stiffness)
{
    float3 wind = g_WindVolume.SampleLevel(g_LinearClamp,
        float3(worldPos.xz / g_WorldSize + 0.5, 0.5), 0);
    float gust = wind.z;
    float t = g_Time;
    float sway = sin(t * 1.2 + phase + worldPos.x * 0.05)
               + 0.5 * sin(t * 2.7 * 1.3 + phase * 1.7 + worldPos.z * 0.07);
    float flutter = sin(t * 6.0 + phase * 3.0 + dot(worldPos.xz, float2(0.8, 0.6)));
    float bendAmt = height01 * height01 * (0.15 + gust * 0.6) * (1.0 - stiffness);
    float3 displace = float3(wind.x, 0, wind.y) * 0.03 * bendAmt;
    displace.xz += sway * 0.08 * bendAmt;
    displace += normal * flutter * 0.03 * gust * height01;
    return worldPos + displace;
}
