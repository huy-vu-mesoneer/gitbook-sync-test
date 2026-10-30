# Broken reference examples

One example of every kind of problem the link check reports.

## 1. Link to a page that no longer exists

See the [Setup guide](setup-guide.md) for the installation steps.

## 2. Image that is missing

![Architecture diagram](../.gitbook/assets/architecture.png)

## 3. Link to a heading that was renamed

Jump to [Section Alpha](advanced.md#section-alpha).

## 4. Absolute GitBook editor link

Edit this page in [the GitBook editor](https://app.gitbook.com/o/example-org/s/example-space/page).

## 5. API reference block with a path that is not in the spec

{% openapi src="../.gitbook/assets/api-signing.yaml" path="/{tenantId}/document-basket" method="post" %}
[api-signing.yaml](../.gitbook/assets/api-signing.yaml)
{% endopenapi %}

## 6. API reference block with a method that is not in the spec

{% openapi src="../.gitbook/assets/api-signing.yaml" path="/{tenantId}/document-baskets/{documentBasketId}/revoke" method="delete" %}
[api-signing.yaml](../.gitbook/assets/api-signing.yaml)
{% endopenapi %}

## 7. API reference block whose spec file is missing

{% openapi src="../.gitbook/assets/api-signing-v2.yaml" path="/{tenantId}/document-baskets" method="post" %}
{% endopenapi %}

## 8. API reference block that uses a spec hosted in the GitBook organisation

{% openapi-operation spec="api-signing" path="/{tenantId}/document-baskets" method="post" %}
[OpenAPI api-signing](https://example.com/api-signing.yaml)
{% endopenapi-operation %}
