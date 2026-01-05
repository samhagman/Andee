# Sandbox SDK Platform Information

Pricing, limits, and beta information for Cloudflare Sandbox SDK.

---

## Pricing

Sandbox SDK pricing is determined by the underlying [Containers](https://developers.cloudflare.com/containers/) platform.

### Container Costs

Refer to [Containers pricing](https://developers.cloudflare.com/containers/pricing/) for complete details on:

- vCPU, memory, and disk usage rates
- Network egress pricing
- Instance types and their costs

### Related Pricing

When using Sandbox, you'll also be billed for:

| Service | What It Does | Pricing Docs |
|---------|--------------|--------------|
| Workers | Handles incoming requests to your sandbox | [Workers pricing](https://developers.cloudflare.com/workers/platform/pricing/) |
| Durable Objects | Powers each sandbox instance | [Durable Objects pricing](https://developers.cloudflare.com/durable-objects/platform/pricing/) |
| Workers Logs | Optional observability (if enabled) | [Workers Logs pricing](https://developers.cloudflare.com/workers/observability/logs/workers-logs/#pricing) |

---

## Limits

Since the Sandbox SDK is built on top of the [Containers](https://developers.cloudflare.com/containers/) platform, it shares the same underlying limits.

### Container Limits

Refer to [Containers limits](https://developers.cloudflare.com/containers/platform-details/limits/) for complete details on:

- Memory, vCPU, and disk limits for concurrent container instances
- Instance types and their resource allocations
- Image size and storage limits

### Instance Types

| Type | vCPU | Memory | Disk | Best For |
|------|------|--------|------|----------|
| `lite` | 0.25 | 512 MB | 2 GB | Light scripts, simple tasks |
| `standard` | 1 | 2 GB | 10 GB | Most workloads |
| `large` | 4 | 8 GB | 20 GB | ML, large builds |

### Best Practices to Work Within Limits

- **Right-size your instances** - Choose the appropriate instance type based on your workload requirements
- **Clean up unused sandboxes** - Call `destroy()` when sandboxes are no longer needed to free up resources
- **Optimize images** - Keep your custom Dockerfiles lean to reduce image size
- **Use `sleepAfter`** - Configure auto-sleep for sandboxes that may be idle

### Port Restrictions

- Ports must be in range 1024-65535
- Port 3000 is reserved for SDK internal use
- `.workers.dev` domain doesn't support wildcard subdomains for preview URLs

---

## Beta Information

Sandbox SDK is currently in **open beta**. The product is publicly available and ready to use, but Cloudflare is actively gathering feedback and may make changes.

### What to Expect During Beta

- **API stability** - The core API is stable, but new features may be introduced or existing ones adjusted based on feedback
- **Production use** - You can use Sandbox SDK in production, but be aware of potential changes
- **Active development** - Continuous improvements to performance, features, and bug fixes
- **Documentation updates** - Guides and examples will be refined as Cloudflare learns from real-world usage

### Known Limitations

See [Containers Beta Information](https://developers.cloudflare.com/containers/beta-info/) for current limitations and known issues, as Sandbox SDK inherits the same constraints.

### Feedback Channels

Cloudflare wants to hear about your experience:

- **What are you building?**
- **What features would be most valuable?**
- **What challenges have you encountered?**
- **What instance sizes do you need?**

Share feedback:
- [GitHub Issues](https://github.com/cloudflare/sandbox-sdk/issues) - Report bugs or request features
- [Developer Discord](https://discord.cloudflare.com) - Chat with the team and community
- [Community Forum](https://community.cloudflare.com) - Discuss use cases and best practices

Check the [GitHub repository](https://github.com/cloudflare/sandbox-sdk) for the latest updates and upcoming features.

---

## Version Compatibility

Always match your npm package version with the Docker image version:

```dockerfile
# If using @cloudflare/sandbox@0.3.3
FROM docker.io/cloudflare/sandbox:0.3.3
```

Mismatched versions can cause features to break or behave unexpectedly. The SDK automatically checks version compatibility on startup and logs warnings if versions don't match.

---

## Local Development vs Production

| Feature | Local Dev (`wrangler dev`) | Production |
|---------|---------------------------|------------|
| Port exposure | Requires `EXPOSE` in Dockerfile | Automatic |
| Bucket mounting | Not supported | Works |
| Preview URLs | `localhost:8787/...` | `https://{port}-{id}.yourdomain.com` |
| Custom domain | Not required | Required for preview URLs |

---

## External Resources

- [GitHub Repository](https://github.com/cloudflare/sandbox-sdk)
- [Cloudflare Containers docs](https://developers.cloudflare.com/containers/)
- [Workers AI docs](https://developers.cloudflare.com/workers-ai/)
- [R2 documentation](https://developers.cloudflare.com/r2/)
