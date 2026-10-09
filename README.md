# directus-extension-access-inspector

A [Directus](https://directus.io/) module that shows what a user, a role or the public can do in each collection, field
by field, and which policy allows it.

![A user's access to each collection, with their policies in the sidebar](https://github.com/user-attachments/assets/df34686f-1b50-46a1-ac8e-eb637af0c2e5)

## Features

- [Access to every collection and action](#choose-who-to-inspect), combining policies from roles, parent roles, the user
  and the public the way Directus does
- [Item rules, fields, validation and presets](#see-why), and the policy behind each
- [Item testing](#see-why), including which fields come back null on a specific item
- [Who can access a collection](#who-can-access-a-collection)
- [API request checks](#check-an-api-request): whether Directus would allow a request, and why
- [Comparisons and what-if simulations](#compare-and-simulate) of other roles or policies

## Installation

Requires Directus 11 or 12. Install it from the Directus Marketplace, or with npm in your Directus project:

```shell
npm install directus-extension-access-inspector
```

Then enable **Access Inspector** in the module bar, under Settings > Settings. Like Settings > Access Policies, it's
only available to admins.

## Usage

### Choose who to inspect

Pick the public, a role or a user in the navigation. The search at the top filters both lists.

The table shows each collection with a chip per action, styled like Settings > Access Policies:

| Chip   | Meaning                                                         |
| ------ | --------------------------------------------------------------- |
| Solid  | Full access: every item and every field.                        |
| Light  | Custom access: only items matching a rule, or only some fields. |
| Border | No access.                                                      |

The **Policies** sidebar lists the policies that apply in priority order, and where each comes from: a role, a parent
role, the user or the public. Names link to their settings. When some policies are limited to certain networks, an **IP
Address** there shows access from that address; without one, those policies are included.

### See why

Select a chip to see what's behind it, combined across every policy that applies:

- **Item Permissions:** each policy's rule. An item is allowed when it matches any of them.
- **Field Permissions:** each field and the policies that grant it.
- **Field Validation:** the rules a payload must pass. Every rule must pass, from every policy.
- **Field Presets:** default values, and which policy's value wins when several set the same field.

![The rules for updating articles, tested against item 3](https://github.com/user-attachments/assets/ce78a42e-08b8-4cd9-92f4-fafd88007b3a)

**Test an Item** takes a primary key and shows which rules match that item, and so whether the action and each field
apply to it. Variables such as `$CURRENT_USER.section` are resolved for the inspected user.

In **Field Permissions**, a half-filled circle marks a field that only some policies grant. On items allowed only
through the other policies, reads return it as null and updates can't change it. A link icon marks a relational field;
select it to see what can be read in the related collection.

![The fields that can be read, some null on some items](https://github.com/user-attachments/assets/2d37cc47-7e6f-4b20-a0bc-5566470a3ffb)

### Who can access a collection

Select a collection's name to see everyone's access to it: the public, every role, and the users with policies of their
own. Select one to inspect it.

![Everyone's access to articles](https://github.com/user-attachments/assets/a1605ba6-d4c1-4e87-8e91-0c1ff8791485)

### Check an API request

**Check API Request** in the header takes a request, such as `PATCH /items/articles/3` with a JSON body, and says
whether Directus would allow it (200, 204, 400 or 403) and why. It checks the action, each field and relation in
`fields`, `filter` and `sort`, the item, and validation. Nothing is sent.

![Why updating article 3 is forbidden](https://github.com/user-attachments/assets/ff1e0351-de8f-485f-8026-1c8d523b87d7)

### Compare and simulate

Two sidebar sections mark the actions whose access would differ:

- **Compare:** with another user or role.
- **Simulate:** with a different role, or policies added or excluded. Nothing is saved.

![Michael's access, simulated in the Editor role](https://github.com/user-attachments/assets/98ef848a-c428-48bc-b6c9-ab5bbe58305f)

The address includes who is inspected, the comparison and the simulation, so it can be shared.

## License

[MIT](LICENSE)
