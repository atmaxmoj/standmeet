package entity

// ProviderModel —— a provider as a feature sees it: its label and model. Empty label = the
// holder names none and falls to the owner's default.
type ProviderModel struct {
	Label string
	Model string
}

// RoleProvider —— a role, the provider it names, and how many live codes assume it.
type RoleProvider struct {
	Provider ProviderModel
	Name     string
	Codes    int64
}

// CodeProvider —— a live code that names its own provider.
type CodeProvider struct {
	Provider ProviderModel
	Code     string
}

// ModelMap —— everything instance.models resolves from: the default and every override.
type ModelMap struct {
	Default ProviderModel
	Roles   []RoleProvider
	Codes   []CodeProvider
}
