import { defineModule } from '@directus/extensions-sdk';
import InspectorModule from './module.vue';

export default defineModule({
	id: 'access-inspector',
	name: 'Access Inspector',
	icon: 'policy',
	routes: [{ path: '', component: InspectorModule }],
	// Reading every role, policy and permission needs admin access, like Settings > Access Policies.
	preRegisterCheck: (user) => user.admin_access === true,
});
