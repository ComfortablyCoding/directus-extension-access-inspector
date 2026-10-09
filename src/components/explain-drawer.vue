<script setup lang="ts">
import { useApi } from '@directus/extensions-sdk';
import { computed, ref, watch } from 'vue';
import { useInspectorContext } from '../composables/use-context.js';
import { useLabels } from '../composables/use-labels.js';
import type { PermissionRow } from '../lib/access.js';
import { type Explanation, explain, parseRequest } from '../lib/explain.js';
import { loadVariableContext, testItem } from '../lib/load.js';
import type { PolicyRow } from '../lib/policies.js';
import type { FieldInfo } from '../lib/schema.js';

// Checks whether Directus would allow an API request for the inspected subject, and why, like a policy troubleshooter.
const props = defineProps<{
	open: boolean;
	subjectName: string;
	permissions: PermissionRow[];
	policies: Map<string, PolicyRow>;
	admin: boolean;
	primaryOf: (collection: string) => string | undefined;
	fieldsOf: (collection: string) => FieldInfo[];
	/** A collection for the example request. */
	example: string | null;
}>();

const emit = defineEmits<{ close: [] }>();

const api = useApi();
const context = useInspectorContext();
const { policyName } = useLabels();

const request = ref('');
const result = ref<Explanation | null>(null);
const error = ref<string | null>(null);
const running = ref(false);

const placeholder = computed(() => {
	const collection = props.example ?? 'articles';
	return `PATCH /items/${collection}/1\n{ "title": "Hello" }`;
});

watch(
	() => props.open,
	(open) => {
		if (open && !request.value && props.example) request.value = `GET /items/${props.example}?fields=*`;
	},
);

// A new subject or simulation changes the answer, including for a check still running.
let checks = 0;

watch(
	() => [context?.subject.value, context?.resolution.value],
	() => {
		checks++;
		result.value = null;
		running.value = false;
	},
);

async function run() {
	const subject = context?.subject.value;
	const resolution = context?.resolution.value;
	if (!context || !subject || !resolution) return;

	error.value = null;
	result.value = null;

	const parsed = parseRequest(request.value, Object.keys(context.access.value));
	if ('error' in parsed) {
		error.value = parsed.error;
		return;
	}

	running.value = true;
	const current = ++checks;

	try {
		const variables = await loadVariableContext(api, {
			subject,
			resolution,
			rules: props.permissions.flatMap(({ permissions, validation, presets }) => [permissions, validation, presets]),
		});

		const explanation = await explain(parsed, {
			access: context.access.value,
			relations: context.relations.value,
			admin: props.admin,
			primaryOf: props.primaryOf,
			fieldInfo: (collection, field) => props.fieldsOf(collection).find((info) => info.field === field),
			collectionName: context.collectionName,
			policyName: (permission) =>
				policyName(permission.policy ? (props.policies.get(permission.policy) ?? null) : null),
			variables,
			testItem: (collection, key, rules) =>
				testItem(api, { collection, primary: props.primaryOf(collection)!, key, rules }),
		});
		if (current === checks) result.value = explanation;
	} catch (err) {
		if (current === checks) error.value = `Couldn’t check this request: ${(err as Error).message}`;
	} finally {
		if (current === checks) running.value = false;
	}
}

const verdict = computed(() => {
	const status = result.value?.status;
	if (!status) return null;
	if (status === 403)
		return {
			type: 'danger',
			icon: 'block',
			text: `Forbidden: Directus would respond with 403 for ${props.subjectName}.`,
		};
	if (status === 400)
		return {
			type: 'warning',
			icon: 'rule',
			text: `Rejected: Directus would respond with 400 for ${props.subjectName}.`,
		};
	return {
		type: 'success',
		icon: 'check_circle',
		text: `Allowed: Directus would respond with ${status} for ${props.subjectName}.`,
	};
});

const STEP_ICONS = { pass: 'check_circle', fail: 'cancel', warn: 'warning' } as const;
</script>

<template>
	<v-drawer
		:model-value="open"
		title="Check API Request"
		icon="troubleshoot"
		@cancel="emit('close')"
		@update:model-value="!$event && emit('close')"
	>
		<div class="explain">
			<v-notice>
				See whether Directus would allow an API request for {{ subjectName }}, and why. The request isn’t sent.
			</v-notice>

			<div class="field">
				<div class="label">API Request</div>
				<v-textarea v-model="request" :placeholder="placeholder" class="request" @keydown.meta.enter="run" />
				<div class="hint">A method and path, then an optional JSON body on the next lines.</div>
			</div>

			<div>
				<v-button :loading="running" :disabled="!request.trim()" @click="run">Check</v-button>
			</div>

			<v-notice v-if="error" type="danger">{{ error }}</v-notice>

			<template v-if="result && verdict">
				<v-notice :type="verdict.type" :icon="verdict.icon">{{ verdict.text }}</v-notice>

				<ol class="steps">
					<li v-for="(step, index) in result.steps" :key="index" :class="step.status">
						<v-icon :name="STEP_ICONS[step.status]" small class="step-icon" />
						<div>
							<div class="step-title">{{ step.title }}</div>
							<div v-if="step.detail" class="step-detail">{{ step.detail }}</div>
						</div>
					</li>
				</ol>
			</template>
		</div>
	</v-drawer>
</template>

<style scoped>
.explain {
	display: grid;
	gap: 24px;
	padding: var(--content-padding);
	padding-block: 48px var(--content-padding-bottom, 32px);
}

.field {
	display: grid;
	gap: 8px;
}

.label {
	color: var(--theme--foreground-accent);
	font-weight: 600;
}

.request :deep(textarea) {
	min-block-size: 140px;
	font-family: var(--theme--fonts--monospace--font-family);
	font-size: 13px;
}

.hint {
	color: var(--theme--foreground-subdued);
	font-size: 12px;
}

.steps {
	display: grid;
	gap: 14px;
	margin: 0;
	padding: 16px;
	border: var(--theme--border-width) solid var(--theme--form--field--input--border-color, var(--theme--border-color));
	border-radius: var(--theme--border-radius);
	list-style: none;
}

.steps li {
	display: flex;
	align-items: flex-start;
	gap: 10px;
}

.step-icon {
	flex-shrink: 0;
	margin-block-start: 1px;
}

.pass .step-icon {
	--v-icon-color: var(--theme--success);
}

.fail .step-icon {
	--v-icon-color: var(--theme--danger);
}

.warn .step-icon {
	--v-icon-color: var(--theme--warning);
}

.step-title {
	color: var(--theme--foreground);
	font-weight: 600;
}

.step-detail {
	margin-block-start: 2px;
	color: var(--theme--foreground-subdued);
	font-size: 13px;
	line-height: 1.5;
}
</style>
