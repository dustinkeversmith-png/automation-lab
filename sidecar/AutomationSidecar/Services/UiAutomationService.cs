using System.Windows.Automation;

namespace AutomationSidecar.Services;

public sealed class UiAutomationService
{
    public object FindWindowByProcessId(int processId)
    {
        var root = AutomationElement.RootElement;
        var condition = new PropertyCondition(AutomationElement.ProcessIdProperty, processId);
        var window = root.FindFirst(TreeScope.Children, condition);

        if (window == null)
            throw new InvalidOperationException($"Window not found for process {processId}");

        return new
        {
            Name = window.Current.Name,
            ClassName = window.Current.ClassName,
            NativeHandle = window.Current.NativeWindowHandle
        };
    }
}