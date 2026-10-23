import type { HostCompatibility, HostInfo, TargetKind, TargetPlatform } from '@phoenix/contracts';
import type { StructuralStatus } from '../formats/reader.js';

/** Eligibility information only. A compatible header never grants permission to execute. */
export function hostCompatibility(
  platform: TargetPlatform | undefined,
  host: HostInfo,
  kind: TargetKind,
  structuralStatus: StructuralStatus = 'incomplete',
): HostCompatibility {
  const result = (
    nativeExecution: HostCompatibility['nativeExecution'],
    reason: string,
  ): HostCompatibility => ({ staticAnalysis: 'supported', nativeExecution, reason });
  if (kind === 'web' || kind === 'source' || kind === 'wasm' || kind === 'dotnet' || platform?.os === 'any')
    return result('not-applicable', 'Requires a separate browser, build or language runtime workflow');
  if (structuralStatus !== 'validated')
    return result('unknown', 'Supported structural checks failed, are incomplete or were not supplied');
  if (platform === undefined || platform.os === 'unknown')
    return result('unknown', 'No reliable native platform established');
  if (
    platform.binaryType === 'object' ||
    platform.binaryType === 'shared-library' ||
    platform.binaryType === 'core' ||
    platform.binaryType === 'bundle'
  )
    return result('not-applicable', 'Artifact is not a standalone native executable');
  if (platform.osBasis === 'assumed')
    return result('unknown', 'OS is only assumed; native execution compatibility is unverified');
  if (platform.binaryType !== 'executable')
    return result('unknown', 'Standalone executable identity has not been established');
  if (platform.os !== host.os)
    return result('incompatible', 'Target OS differs from host; static inspection remains available');
  if (host.arch === 'other' || host.arch === 'unknown')
    return result('unknown', 'Host CPU identity has not been established');
  if (platform.arches.includes(host.arch))
    return result(
      'compatible',
      'Header OS and CPU match the host; dependencies and execution approval remain unverified',
    );
  if (host.os === 'macos' && host.arch === 'arm64' && platform.arches.includes('x64'))
    return result('emulation-required', 'Requires a separately verified Rosetta installation');
  if (
    platform.arches.length === 0 ||
    platform.arches.includes('other') ||
    platform.arches.includes('unknown')
  )
    return result('unknown', 'Target CPU could not be determined');
  return result('incompatible', 'Target CPU differs from host; an explicit foreign runner is required');
}
