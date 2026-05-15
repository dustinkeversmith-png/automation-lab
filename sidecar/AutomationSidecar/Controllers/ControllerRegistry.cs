using AutomationSidecar.Models;

namespace AutomationSidecar.Controllers;

public sealed class ControllerRegistry
{
    private readonly List<SidecarControllerBase> _controllers = new();

    public ControllerRegistry Register(SidecarControllerBase controller)
    {
        _controllers.Add(controller);
        return this;
    }

    public SidecarControllerBase? Resolve(string method)
    {
        return _controllers.FirstOrDefault(c => c.CanHandle(method));
    }

    public async Task<object?> DispatchAsync(
        CommandEnvelope cmd,
        CancellationToken cancellationToken = default)
    {
        var controller = Resolve(cmd.method);
        if (controller == null)
            throw new InvalidOperationException($"Unknown method: {cmd.method}");

        return await controller.HandleAsync(cmd, cancellationToken);
    }
}