mock_provider "azurerm" {}

variables {
  name                = "law-test-001"
  resource_group_name = "rg-test"
  location            = "westeurope"
}

# B1 — the default retention (30 days, from variables.tf) reaches the resource.
# A caller that supplies nothing must get the documented 30-day lifecycle; if the
# default is ever bumped in variables.tf this run catches it.
run "default_retention_is_30" {
  command = plan

  assert {
    condition     = azurerm_log_analytics_workspace.this.retention_in_days == 30
    error_message = "Default retention must be 30 days; callers who rely on this default would silently get a different lifecycle."
  }
}

# B2 — a non-default retention value flows to the resource rather than being ignored.
# If main.tf were ever refactored to hard-code retention instead of using var.retention_in_days,
# this test fails while the default-value test above would incorrectly stay green.
run "custom_retention_flows_through" {
  command = plan

  variables {
    retention_in_days = 90
  }

  assert {
    condition     = azurerm_log_analytics_workspace.this.retention_in_days == 90
    error_message = "var.retention_in_days must reach the workspace; the resource must not ignore the caller's value."
  }
}

# B4 — tags provided by the caller appear on the workspace.
# Tests that var.tags is wired to the resource and not silently dropped.
run "tags_propagate_to_workspace" {
  command = plan

  variables {
    tags = {
      environment = "test"
      team        = "platform"
    }
  }

  assert {
    condition     = azurerm_log_analytics_workspace.this.tags["environment"] == "test"
    error_message = "The 'environment' tag must be present on the workspace."
  }

  assert {
    condition     = azurerm_log_analytics_workspace.this.tags["team"] == "platform"
    error_message = "The 'team' tag must be present on the workspace."
  }
}
