mock_provider "azurerm" {}
mock_provider "external" {}

override_data {
  target = data.external.build_info
  values = { result = { revision = "test" } }
}

variables {
  name                 = "test-fn"
  resource_group_name  = "test-rg"
  location             = "westeurope"
  storage_account_name = "sttest"
  storage_account_id   = "/subscriptions/00000000-0000-0000-0000-000000000000/resourceGroups/test-rg/providers/Microsoft.Storage/storageAccounts/sttest"
}

run "sku_defaults_to_ep1" {
  command = plan

  assert {
    condition     = azurerm_service_plan.this.sku_name == "EP1"
    error_message = "Default SKU must be EP1; the variable default changed."
  }
}

run "custom_sku_is_passed_through" {
  command = plan

  variables {
    sku_name = "Y1"
  }

  assert {
    condition     = azurerm_service_plan.this.sku_name == "Y1"
    error_message = "The sku_name variable must flow through to the service plan."
  }
}

run "https_only_is_enforced" {
  command = plan

  assert {
    condition     = azurerm_linux_function_app.this.https_only == true
    error_message = "https_only must be true; removing it allows plaintext HTTP traffic."
  }
}

run "tls_minimum_version_is_1_2" {
  command = plan

  assert {
    condition     = azurerm_linux_function_app.this.site_config[0].minimum_tls_version == "1.2"
    error_message = "Minimum TLS version must stay at 1.2; downgrading allows weak ciphers."
  }
}

run "system_assigned_identity_is_configured" {
  command = plan

  assert {
    condition     = azurerm_linux_function_app.this.identity[0].type == "SystemAssigned"
    error_message = "A SystemAssigned identity must be present so managed-identity storage access works."
  }
}

run "storage_managed_identity_auth_is_enabled" {
  command = plan

  assert {
    condition     = azurerm_linux_function_app.this.storage_uses_managed_identity == true
    error_message = "storage_uses_managed_identity must be true; reverting to key-based auth weakens the security posture."
  }
}

run "public_network_access_follows_input" {
  command = plan

  variables {
    public_network_access_enabled = false
  }

  assert {
    condition     = azurerm_linux_function_app.this.public_network_access_enabled == false
    error_message = "public_network_access_enabled must reflect the input variable."
  }
}

run "python_version_defaults_to_3_12" {
  command = plan

  assert {
    condition     = azurerm_linux_function_app.this.site_config[0].application_stack[0].python_version == "3.12"
    error_message = "Default Python version must be 3.12; the variable default changed."
  }
}

run "build_revision_injected_into_app_settings" {
  command = plan

  assert {
    condition     = azurerm_linux_function_app.this.app_settings["BUILD_REVISION"] == "test"
    error_message = "BUILD_REVISION must be injected from the external build-info data source."
  }
}

run "user_app_settings_preserved_alongside_build_revision" {
  command = plan

  variables {
    app_settings = { FOO = "bar" }
  }

  assert {
    condition     = azurerm_linux_function_app.this.app_settings["FOO"] == "bar"
    error_message = "User-provided app settings must be preserved in the merged map."
  }

  assert {
    condition     = azurerm_linux_function_app.this.app_settings["BUILD_REVISION"] == "test"
    error_message = "BUILD_REVISION must remain present alongside user-provided app settings."
  }
}

run "storage_role_assignment_scoped_to_storage_account" {
  command = plan

  assert {
    condition     = azurerm_role_assignment.runtime_storage.scope == "/subscriptions/00000000-0000-0000-0000-000000000000/resourceGroups/test-rg/providers/Microsoft.Storage/storageAccounts/sttest"
    error_message = "Role assignment scope must be the storage account ID passed as input."
  }
}
