import { useState } from 'react'
import { useStore } from '../engine/store'
import {
  SIGNABLE_PARAMETERS,
  SIGNATURE_REQUIREMENT_LABEL,
  type SignaturePolicy,
  type SignatureRequirement
} from '../engine/electronicSignatures'

/** DV09-080 System Configuration > Setup > Electronic Signatures: application, policies, areas and modules. */
export function SignatureSetupPanel(): JSX.Element {
  const config = useStore((s) => s.signature)
  const areas = useStore((s) => s.areas)
  const modules = useStore((s) => s.modules)
  const sfcs = useStore((s) => s.sfcs)
  const setApplication = useStore((s) => s.setSignatureApplication)
  const savePolicy = useStore((s) => s.saveSignaturePolicy)
  const deletePolicy = useStore((s) => s.deleteSignaturePolicy)
  const setArea = useStore((s) => s.setSignatureArea)
  const setModulePolicy = useStore((s) => s.setModuleSignaturePolicy)
  const [name, setName] = useState('')
  const [draft, setDraft] = useState<Record<string, SignatureRequirement>>({})
  const [sameOk, setSameOk] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [moduleTag, setModuleTag] = useState('')
  const policyNames = Object.keys(config.policies)
  const targets = [...Object.keys(modules), ...Object.keys(sfcs)].sort()

  function edit(policy: SignaturePolicy): void {
    setName(policy.name)
    setDraft({ ...policy.parameters })
    setSameOk(policy.allowSamePerson)
  }

  return (
    <div className="signature-setup">
      <h3>Setup — Electronic Signatures</h3>
      <p>
        An operator write to a parameter on a policy is staged until the required signature succeeds: none, one
        (confirm) or two (confirm and verify). Enable the application, enable the plant area, associate a policy with
        the module, then list its parameters. The verifier must hold the Action Verify key.
      </p>

      <h4>Application</h4>
      <label>
        <input type="checkbox" checked={config.operate} onChange={(e) => setApplication({ operate: e.target.checked })} />{' '}
        Electronic Signatures in DeltaV Operate
      </label>
      <label style={{ display: 'block' }}>
        <input
          type="checkbox"
          checked={config.controlStudio}
          onChange={(e) => setApplication({ controlStudio: e.target.checked })}
        />{' '}
        Electronic Signatures in DeltaV Control Studio
      </label>

      <h4>Plant areas</h4>
      {areas.map((area) => (
        <label key={area} style={{ display: 'block' }}>
          <input type="checkbox" checked={config.areas.includes(area)} onChange={(e) => setArea(area, e.target.checked)} />{' '}
          {area}
        </label>
      ))}

      <h4>Signature policies</h4>
      {policyNames.length === 0 && <p>No policies yet.</p>}
      {policyNames.map((policyName) => (
        <div key={policyName} className="signature-policy-row">
          <b>{policyName}</b>{' '}
          <span>
            {Object.entries(config.policies[policyName].parameters)
              .map(([parameter, requirement]) => `${parameter}: ${SIGNATURE_REQUIREMENT_LABEL[requirement]}`)
              .join('; ')}
            {config.policies[policyName].allowSamePerson ? ' (same person may verify)' : ''}
          </span>{' '}
          <button className="fp-btn" onClick={() => edit(config.policies[policyName])}>
            Properties
          </button>
          <button className="fp-btn" onClick={() => deletePolicy(policyName)}>
            Delete
          </button>
        </div>
      ))}

      <h4>New Signature Policy / Parameter Confirmation</h4>
      <label>
        Policy name <input value={name} onChange={(e) => setName(e.target.value)} />
      </label>
      <table className="exp-table">
        <thead>
          <tr>
            <th>Parameter</th>
            <th>Signature requirement</th>
          </tr>
        </thead>
        <tbody>
          {SIGNABLE_PARAMETERS.map((parameter) => (
            <tr key={parameter}>
              <td>{parameter}</td>
              <td>
                <select
                  aria-label={`Requirement for ${parameter}`}
                  value={draft[parameter] ?? 'NONE'}
                  onChange={(e) => setDraft({ ...draft, [parameter]: e.target.value as SignatureRequirement })}
                >
                  {(Object.keys(SIGNATURE_REQUIREMENT_LABEL) as SignatureRequirement[]).map((requirement) => (
                    <option key={requirement} value={requirement}>
                      {SIGNATURE_REQUIREMENT_LABEL[requirement]}
                    </option>
                  ))}
                </select>
              </td>
            </tr>
          ))}
        </tbody>
      </table>
      <label style={{ display: 'block' }}>
        <input type="checkbox" checked={sameOk} onChange={(e) => setSameOk(e.target.checked)} /> Allow the same person to
        confirm and verify
      </label>
      <button
        className="tbtn sm"
        onClick={() => {
          const parameters = Object.fromEntries(Object.entries(draft).filter(([, requirement]) => requirement !== 'NONE'))
          setError(savePolicy({ name: name.trim(), description: '', allowSamePerson: sameOk, parameters }))
        }}
      >
        Save Policy
      </button>
      {error && <p role="alert">{error}</p>}

      <h4>Module associations</h4>
      <select aria-label="Module" value={moduleTag} onChange={(e) => setModuleTag(e.target.value)}>
        <option value="">Select a module</option>
        {targets.map((tag) => (
          <option key={tag} value={tag}>
            {tag}
          </option>
        ))}
      </select>
      <select
        aria-label="Policy for module"
        disabled={!moduleTag}
        value={config.modules[moduleTag] ?? ''}
        onChange={(e) => setModulePolicy(moduleTag, e.target.value || undefined)}
      >
        <option value="">No policy</option>
        {policyNames.map((policyName) => (
          <option key={policyName} value={policyName}>
            {policyName}
          </option>
        ))}
      </select>
      <ul>
        {Object.entries(config.modules).map(([tag, policy]) => (
          <li key={tag}>
            {tag} → {policy}
          </li>
        ))}
      </ul>
    </div>
  )
}
