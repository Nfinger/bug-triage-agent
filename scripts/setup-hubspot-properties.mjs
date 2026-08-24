#!/usr/bin/env node
// One-time portal setup for the prospecting agent: creates the custom
// properties the run writes and filters on, skipping any that already exist.
//
//   node --env-file=.dev.vars scripts/setup-hubspot-properties.mjs
//
// Needs HUBSPOT_ACCESS_TOKEN with crm.schemas.companies.write and
// crm.schemas.contacts.write.

const token = process.env.HUBSPOT_ACCESS_TOKEN?.trim();
if (!token) {
	console.error('HUBSPOT_ACCESS_TOKEN must be set');
	process.exit(1);
}

const GROUP = { companies: 'companyinformation', contacts: 'contactinformation' };

const PROPERTIES = {
	companies: [
		{
			name: 'last_prospected_at',
			label: 'Last prospected at',
			description: 'Date the prospecting agent last selected this company. Drives the re-contact cooldown.',
			type: 'date',
			fieldType: 'date',
		},
		{
			name: 'do_not_prospect',
			label: 'Do not prospect',
			description: 'When true, the prospecting agent never selects this company.',
			type: 'bool',
			fieldType: 'booleancheckbox',
			options: [
				{ label: 'Yes', value: 'true', displayOrder: 0 },
				{ label: 'No', value: 'false', displayOrder: 1 },
			],
		},
	],
	contacts: [
		{
			name: 'do_not_contact',
			label: 'Do not contact',
			description: 'When true, the prospecting agent never emails this contact.',
			type: 'bool',
			fieldType: 'booleancheckbox',
			options: [
				{ label: 'Yes', value: 'true', displayOrder: 0 },
				{ label: 'No', value: 'false', displayOrder: 1 },
			],
		},
		{
			name: 'agent_created',
			label: 'Created by prospecting agent',
			description: 'True when the prospecting agent created this contact from research.',
			type: 'bool',
			fieldType: 'booleancheckbox',
			options: [
				{ label: 'Yes', value: 'true', displayOrder: 0 },
				{ label: 'No', value: 'false', displayOrder: 1 },
			],
		},
		{
			name: 'agent_created_run',
			label: 'Prospecting run that created this contact',
			description: 'Run date (YYYY-MM-DD) of the prospecting run that created this contact.',
			type: 'string',
			fieldType: 'text',
		},
	],
};

async function call(method, path, body) {
	const response = await fetch(`https://api.hubapi.com${path}`, {
		method,
		headers: { authorization: `Bearer ${token}`, 'content-type': 'application/json' },
		body: body === undefined ? undefined : JSON.stringify(body),
	});
	const text = await response.text();
	return { status: response.status, body: text ? JSON.parse(text) : undefined };
}

let failed = false;
for (const [objectType, properties] of Object.entries(PROPERTIES)) {
	for (const property of properties) {
		const existing = await call('GET', `/crm/v3/properties/${objectType}/${property.name}`);
		if (existing.status === 200) {
			console.log(`${objectType}.${property.name}: exists`);
			continue;
		}
		if (existing.status !== 404) {
			console.error(`${objectType}.${property.name}: lookup failed (${existing.status}) ${existing.body?.message ?? ''}`);
			failed = true;
			continue;
		}
		const created = await call('POST', `/crm/v3/properties/${objectType}`, { ...property, groupName: GROUP[objectType] });
		if (created.status === 201) {
			console.log(`${objectType}.${property.name}: created`);
		} else {
			console.error(`${objectType}.${property.name}: create failed (${created.status}) ${created.body?.message ?? ''}`);
			failed = true;
		}
	}
}
process.exit(failed ? 1 : 0);
