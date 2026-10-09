export interface CollectionInfo {
	collection: string;
	name: string;
	icon: string;
	system: boolean;
}

export interface FieldInfo {
	field: string;
	name: string;
	type: string;
	/** Such as `conceal`, which limits the filters a field allows. */
	special: string[] | null;
}
