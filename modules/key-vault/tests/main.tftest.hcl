mock_provider "azurerm" {}

variables {
  name                = "kv-tp-test"
  resource_group_name = "rg-test"
  location            = "westeurope"
  tenant_id           = "00000000-0000-0000-0000-000000000000"
  secret_readers = {
    adf = "11111111-1111-1111-1111-111111111111"
  }
}

run "vault_uses_rbac_and_purge_protection" {
  command = plan

  assert {
    condition     = azurerm_key_vault.this.rbac_authorization_enabled == true
    error_message = "The vault must use role-based access, not access policies."
  }

  assert {
    condition     = azurerm_key_vault.this.purge_protection_enabled == true
    error_message = "Purge protection must be on."
  }
}

run "soft_delete_retention_is_30_days" {
  command = plan

  assert {
    condition     = azurerm_key_vault.this.soft_delete_retention_days == 30
    error_message = "Soft-delete retention must be 30 days to guard against accidental deletion."
  }
}

run "network_is_denied_by_default" {
  command = plan

  assert {
    condition     = azurerm_key_vault.this.network_acls[0].default_action == "Deny"
    error_message = "Network ACL default action must be Deny to block unrestricted public access."
  }
}

run "allowed_subnets_are_wired_to_network_acls" {
  command = plan

  variables {
    allowed_subnet_ids = ["/subscriptions/00000000-0000-0000-0000-000000000000/resourceGroups/rg-test/providers/Microsoft.Network/virtualNetworks/vnet-test/subnets/snet-test"]
  }

  assert {
    condition     = contains(tolist(azurerm_key_vault.this.network_acls[0].virtual_network_subnet_ids), "/subscriptions/00000000-0000-0000-0000-000000000000/resourceGroups/rg-test/providers/Microsoft.Network/virtualNetworks/vnet-test/subnets/snet-test")
    error_message = "The allowed subnet must appear in the vault's network ACL subnet list."
  }
}

run "creates_one_role_assignment_per_reader" {
  command = plan

  assert {
    condition     = length(azurerm_role_assignment.secret_reader) == 1
    error_message = "Expected one role assignment for each secret reader."
  }
}

run "reader_principal_id_is_wired_from_input" {
  command = plan

  assert {
    condition     = azurerm_role_assignment.secret_reader["adf"].principal_id == "11111111-1111-1111-1111-111111111111"
    error_message = "Role assignment principal_id must match the value supplied in var.secret_readers."
  }
}

run "no_secret_readers_creates_no_role_assignments" {
  command = plan

  variables {
    secret_readers = {}
  }

  assert {
    condition     = length(azurerm_role_assignment.secret_reader) == 0
    error_message = "No role assignments should exist when secret_readers is empty."
  }
}
