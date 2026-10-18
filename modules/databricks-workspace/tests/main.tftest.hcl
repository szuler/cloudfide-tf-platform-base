mock_provider "azurerm" {}

variables {
  name                = "dbw-tp-test"
  resource_group_name = "rg-test"
  location            = "westeurope"
}

run "no_public_ip_is_true_by_default" {
  command = plan

  assert {
    condition     = azurerm_databricks_workspace.this.custom_parameters[0].no_public_ip == true
    error_message = "Cluster nodes must have no public IP by default — security guard against regression."
  }
}

run "no_public_ip_can_be_disabled" {
  command = plan

  variables {
    no_public_ip = false
  }

  assert {
    condition     = azurerm_databricks_workspace.this.custom_parameters[0].no_public_ip == false
    error_message = "Setting no_public_ip = false must propagate to the workspace custom_parameters block."
  }
}

run "sku_defaults_to_premium" {
  command = plan

  assert {
    condition     = azurerm_databricks_workspace.this.sku == "premium"
    error_message = "The workspace must default to the premium SKU."
  }
}

run "public_network_access_enabled_default" {
  command = plan

  assert {
    condition     = azurerm_databricks_workspace.this.public_network_access_enabled == true
    error_message = "public_network_access_enabled must reflect the variable default of true."
  }
}

run "public_network_access_can_be_disabled" {
  command = plan

  variables {
    public_network_access_enabled = false
  }

  assert {
    condition     = azurerm_databricks_workspace.this.public_network_access_enabled == false
    error_message = "Setting public_network_access_enabled = false must propagate to the workspace."
  }
}

run "sku_standard_is_accepted" {
  command = plan

  variables {
    sku = "standard"
  }

  assert {
    condition     = azurerm_databricks_workspace.this.sku == "standard"
    error_message = "Setting sku = standard must be accepted by the validation and propagated to the workspace."
  }
}

run "rejects_invalid_sku" {
  command = plan

  variables {
    sku = "basic"
  }

  expect_failures = [var.sku]
}
