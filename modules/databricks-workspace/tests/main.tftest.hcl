mock_provider "azurerm" {}

variables {
  name                = "dbw-test-001"
  resource_group_name = "rg-test"
  location            = "westeurope"
}

run "no_public_ip_defaults_to_true" {
  command = plan

  assert {
    condition     = azurerm_databricks_workspace.this.custom_parameters[0].no_public_ip == true
    error_message = "no_public_ip must default to true to prevent cluster nodes from receiving public IP addresses."
  }
}

run "no_public_ip_can_be_disabled" {
  command = plan

  variables {
    no_public_ip = false
  }

  assert {
    condition     = azurerm_databricks_workspace.this.custom_parameters[0].no_public_ip == false
    error_message = "no_public_ip must honour the caller's explicit choice when set to false."
  }
}

run "sku_defaults_to_premium" {
  command = plan

  assert {
    condition     = azurerm_databricks_workspace.this.sku == "premium"
    error_message = "SKU must default to premium."
  }
}

run "sku_accepts_standard" {
  command = plan

  variables {
    sku = "standard"
  }

  assert {
    condition     = azurerm_databricks_workspace.this.sku == "standard"
    error_message = "SKU must accept standard as a valid tier."
  }
}

run "rejects_invalid_sku" {
  command = plan

  variables {
    sku = "enterprise"
  }

  expect_failures = [var.sku]
}

run "public_network_access_defaults_to_true" {
  command = plan

  assert {
    condition     = azurerm_databricks_workspace.this.public_network_access_enabled == true
    error_message = "public_network_access_enabled defaults to true; callers that need private-only access must set it explicitly."
  }
}

run "public_network_access_can_be_disabled" {
  command = plan

  variables {
    public_network_access_enabled = false
  }

  assert {
    condition     = azurerm_databricks_workspace.this.public_network_access_enabled == false
    error_message = "public_network_access_enabled must honour the caller's choice when set to false."
  }
}

run "managed_resource_group_name_derived_from_inputs" {
  command = plan

  assert {
    condition     = azurerm_databricks_workspace.this.managed_resource_group_name == "rg-test-dbw-test-001-managed"
    error_message = "Managed resource group name must be <resource_group_name>-<name>-managed."
  }
}
